/**
 * Web Tools — web scraping and search (opt-in, admin-only).
 *
 * Follows the filesystem-tools.ts pattern: tools are always registered at the
 * MCP protocol level, but feature toggles (exposeWeb) control visibility in
 * the core API response.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServiceConfig } from '@secureyeoman/shared';
import type { ToolMiddleware } from './index.js';
import { wrapToolHandler, textResponse } from './tool-utils.js';
import { ProxyManager, detectCaptcha, RetryableError } from './proxy-manager.js';

const MAX_OUTPUT_BYTES = 500 * 1024; // 500KB output cap
const MAX_BATCH_URLS = 10;
const MAX_BATCH_QUERIES = 5;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;

// ─── SSRF Protection ────────────────────────────────────────

const BLOCKED_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local / cloud metadata
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal', 'metadata.internal'];

/**
 * Normalize alternate IP encodings to canonical dotted-quad / embedded IPv4 so
 * the range checks below cannot be bypassed, e.g. `http://2130706433/` (decimal
 * for 127.0.0.1), `http://0x7f000001/` (hex), `http://017700000001/` (octal),
 * or `http://[::ffff:169.254.169.254]/` (IPv4-mapped IPv6). Returns the input
 * unchanged when it is not a recognized numeric form.
 *
 * NOTE: this does not resolve DNS names — a name that resolves to a private IP
 * (DNS rebinding) is not caught here and requires connect-time IP pinning
 * (tracked for a follow-up).
 */
function normalizeHost(host: string): string {
  const h = host.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) return mapped[1]!;
  // IPv4-mapped IPv6 in hex form (Node normalizes ::ffff:169.254.169.254 →
  // ::ffff:a9fe:a9fe).
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
  }
  const toDotted = (n: number): string =>
    [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) return toDotted(n);
  }
  if (/^0x[0-9a-f]+$/i.test(h)) {
    const n = parseInt(h, 16);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return toDotted(n);
  }
  if (/^0[0-7]+$/.test(h)) {
    const n = parseInt(h, 8);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return toDotted(n);
  }
  return h;
}

class UrlValidationError extends Error {
  constructor(url: string, reason: string) {
    super(`URL "${url}" blocked: ${reason}`);
    this.name = 'UrlValidationError';
  }
}

class ContentSignalBlockedError extends Error {
  constructor(url: string) {
    super(
      `Content-Signal: ai-input=no — "${url}" signals this content is not intended for AI input. ` +
        `Set MCP_RESPECT_CONTENT_SIGNAL=false to override.`
    );
    this.name = 'ContentSignalBlockedError';
  }
}

// ─── YAML Front Matter Helpers ───────────────────────────────

function parseFrontMatter(content: string): { metadata: Record<string, string>; body: string } {
  if (!content.startsWith('---\n')) return { metadata: {}, body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { metadata: {}, body: content };
  const block = content.slice(4, end);
  // Strip the single blank line that conventionally separates front matter from body
  const rawBody = content.slice(end + 5);
  const body = rawBody.startsWith('\n') ? rawBody.slice(1) : rawBody;
  const metadata: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) metadata[key] = value;
  }
  return { metadata, body };
}

import { buildFrontMatter } from '../utils/front-matter.js';
export { buildFrontMatter };

function validateUrl(urlStr: string, config: McpServiceConfig): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new UrlValidationError(urlStr, 'Invalid URL');
  }

  // Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlValidationError(
      urlStr,
      `Protocol "${parsed.protocol}" not allowed, only http/https`
    );
  }

  // Hostname checks. Normalize alternate IP encodings first so decimal/hex/octal
  // /IPv4-mapped forms can't slip past the dotted-quad range patterns.
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = normalizeHost(rawHostname);

  if (BLOCKED_HOSTNAMES.includes(hostname) || BLOCKED_HOSTNAMES.includes(rawHostname)) {
    throw new UrlValidationError(urlStr, 'Hostname blocked (private/reserved)');
  }

  for (const pattern of BLOCKED_IP_RANGES) {
    if (pattern.test(hostname)) {
      throw new UrlValidationError(urlStr, 'IP address blocked (private/reserved range)');
    }
  }

  // Allowlist enforcement
  if (config.allowedUrls.length > 0) {
    const domainAllowed = config.allowedUrls.some((allowed) => {
      const allowedLower = allowed.toLowerCase();
      return hostname === allowedLower || hostname.endsWith('.' + allowedLower);
    });
    if (!domainAllowed) {
      throw new UrlValidationError(
        urlStr,
        `Domain not in allowlist: ${config.allowedUrls.join(', ')}`
      );
    }
  }

  return parsed;
}

// ─── Rate Limiter (web-specific) ────────────────────────────

class WebRateLimiter {
  private timestamps: number[] = [];
  private maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  check(): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Efficient pruning: binary-shift expired entries from the front
    let pruneCount = 0;
    while (pruneCount < this.timestamps.length && this.timestamps[pruneCount]! <= windowStart) {
      pruneCount++;
    }
    if (pruneCount > 0) {
      this.timestamps.splice(0, pruneCount);
    }

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0]!;
      return { allowed: false, retryAfterMs: oldest + 60_000 - now };
    }

    this.timestamps.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }
}

// ─── Fetch Helpers ──────────────────────────────────────────

async function safeFetch(
  urlStr: string,
  config: McpServiceConfig,
  webLimiter: WebRateLimiter,
  proxyManager: ProxyManager | null = null,
  options?: { country?: string; acceptMarkdown?: boolean }
): Promise<{ body: string; finalUrl: string; contentType: string; markdownTokens: number | null }> {
  const rate = webLimiter.check();
  if (!rate.allowed) {
    throw new Error(
      `Web rate limit exceeded (${config.webRateLimitPerMinute}/min). Retry after ${rate.retryAfterMs}ms.`
    );
  }

  const doFetch = async (): Promise<{
    body: string;
    finalUrl: string;
    contentType: string;
    markdownTokens: number | null;
  }> => {
    let currentUrl = urlStr;
    let redirectCount = 0;

    while (redirectCount <= MAX_REDIRECTS) {
      // SSRF validation always applies to the target URL
      validateUrl(currentUrl, config);

      let fetchUrl = currentUrl;
      let extraHeaders: Record<string, string> = {};

      if (proxyManager) {
        const proxyOpts = proxyManager.buildFetchOptions(currentUrl, {
          country: options?.country ?? config.proxyDefaultCountry,
        });
        if (proxyOpts) {
          fetchUrl = proxyOpts.url;
          extraHeaders = proxyOpts.headers;
        }
      }

      const acceptHeader = options?.acceptMarkdown
        ? 'text/markdown, text/html;q=0.9, */*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

      const response = await fetch(fetchUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'SecureYeoman-WebMCP/1.0 (bot)',
          Accept: acceptHeader,
          ...extraHeaders,
        },
      });

      // Handle redirects manually (re-validate each hop)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without Location header');
        currentUrl = new URL(location, currentUrl).href;
        redirectCount++;
        continue;
      }

      const contentType = response.headers.get('content-type') ?? 'text/html';

      // Content-Signal enforcement
      const contentSignal = response.headers.get('content-signal') ?? '';
      if (config.respectContentSignal && contentSignal.includes('ai-input=no')) {
        throw new ContentSignalBlockedError(currentUrl);
      }

      // Token count telemetry from upstream markdown publisher
      const tokenHeader = response.headers.get('x-markdown-tokens');
      const markdownTokens = tokenHeader ? parseInt(tokenHeader, 10) || null : null;

      const body = await response.text();

      // CAPTCHA detection when proxy is active
      if (proxyManager && detectCaptcha(body, response.status)) {
        throw new RetryableError('CAPTCHA detected', response.status, true);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return { body, finalUrl: currentUrl, contentType, markdownTokens };
    }

    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
  };

  // Wrap in fetchWithRetry when proxy is enabled
  if (proxyManager) {
    // fetchWithRetry expects () => Promise<Response>, but we need our full pipeline.
    // We wrap the doFetch call in a retry loop manually.
    let lastError: Error | null = null;
    const maxRetries = config.proxyMaxRetries;
    const baseDelay = config.proxyRetryBaseDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await doFetch();
      } catch (err) {
        if (
          err instanceof RetryableError ||
          (err instanceof Error && err.message.startsWith('HTTP 429'))
        ) {
          lastError = err;
          if (attempt < maxRetries) {
            const delay = Math.min(
              baseDelay * Math.pow(2, attempt) +
                Math.random() * 0.3 * baseDelay * Math.pow(2, attempt),
              15000
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } else {
          throw err;
        }
      }
    }
    throw lastError ?? new Error('Proxy fetch exhausted all retries');
  }

  return doFetch();
}

// ─── Token count estimate ────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateOutput(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes <= MAX_OUTPUT_BYTES) return text;

  // Truncate at byte boundary
  const buf = Buffer.from(text, 'utf-8');
  const truncated = buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf-8');
  return truncated + '\n\n[OUTPUT TRUNCATED — exceeded 500KB limit]';
}

// ─── HTML to Markdown (lightweight) ─────────────────────────

function htmlToMarkdown(html: string): string {
  // Lazy-load node-html-markdown to avoid hard crash if not installed
  try {
    const { NodeHtmlMarkdown } = require('node-html-markdown') as {
      NodeHtmlMarkdown: { translate(html: string): string };
    };
    return NodeHtmlMarkdown.translate(html);
  } catch {
    // Fallback: strip tags manually
    return stripHtmlTags(html);
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWithSelector(html: string, selector: string): string {
  // Basic CSS selector extraction (id and class only)
  const patterns: RegExp[] = [];

  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    patterns.push(
      new RegExp(
        `<[^>]+id=["']${escapeRegExp(id)}["'][^>]*>[\\s\\S]*?(?=<\\/[a-z]+>\\s*<[a-z])`,
        'i'
      )
    );
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    patterns.push(
      new RegExp(
        `<[^>]+class=["'][^"']*\\b${escapeRegExp(cls)}\\b[^"']*["'][^>]*>[\\s\\S]*?(?=<\\/[a-z]+>\\s*<[a-z])`,
        'i'
      )
    );
  } else {
    patterns.push(
      new RegExp(`<${escapeRegExp(selector)}[^>]*>[\\s\\S]*?<\\/${escapeRegExp(selector)}>`, 'gi')
    );
  }

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[0];
  }

  return html;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Search Backend ─────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function performSearch(
  query: string,
  config: McpServiceConfig,
  maxResults: number
): Promise<SearchResult[]> {
  switch (config.webSearchProvider) {
    case 'serpapi':
      return searchSerpApi(query, config.webSearchApiKey ?? '', maxResults);
    case 'tavily':
      return searchTavily(query, config.webSearchApiKey ?? '', maxResults);
    case 'brave':
      return searchBrave(
        query,
        config.braveSearchApiKey ?? config.webSearchApiKey ?? '',
        maxResults
      );
    case 'bing':
      return searchBing(query, config.bingSearchApiKey ?? config.webSearchApiKey ?? '', maxResults);
    case 'exa':
      return searchExa(query, config.exaApiKey ?? config.webSearchApiKey ?? '', maxResults);
    case 'searxng':
      return searchSearxng(query, config.searxngUrl ?? '', maxResults);
    case 'duckduckgo':
    default:
      return searchDuckDuckGo(query, maxResults);
  }
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'SecureYeoman-WebMCP/1.0 (bot)',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse DuckDuckGo HTML results
  const resultPattern =
    /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    results.push({
      url: decodeURIComponent(match[1]!.replace(/.*uddg=/, '').replace(/&.*/, '')),
      title: stripHtmlTags(match[2]!),
      snippet: stripHtmlTags(match[3]!),
    });
  }

  return results;
}

async function searchSerpApi(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!apiKey) throw new Error('SerpAPI requires MCP_WEB_SEARCH_API_KEY');

  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: 'google',
    num: String(maxResults),
  });

  const response = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SerpAPI search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    organic_results?: { title: string; link: string; snippet: string }[];
  };

  return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function searchTavily(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!apiKey) throw new Error('Tavily requires MCP_WEB_SEARCH_API_KEY');

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: { title: string; url: string; content: string }[];
  };

  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

// ─── Additional Search Backends ─────────────────────────────

async function searchBrave(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!apiKey)
    throw new Error('Brave Search requires braveSearchApiKey or MCP_BRAVE_SEARCH_API_KEY');

  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
  });

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    web?: { results?: { title: string; url: string; description: string }[] };
  };

  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function searchBing(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!apiKey) throw new Error('Bing Search requires bingSearchApiKey or MCP_BING_SEARCH_API_KEY');

  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    responseFilter: 'Webpages',
  });

  const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Bing Search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    webPages?: { value?: { name: string; url: string; snippet: string }[] };
  };

  return (data.webPages?.value ?? []).slice(0, maxResults).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: r.snippet,
  }));
}

async function searchExa(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!apiKey) throw new Error('Exa Search requires exaApiKey or MCP_EXA_API_KEY');

  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: maxResults,
      type: 'neural',
      useAutoprompt: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Exa Search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: { title: string; url: string; text?: string; publishedDate?: string }[];
  };

  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? '',
    url: r.url,
    snippet: r.text?.slice(0, 300) ?? '',
  }));
}

async function searchSearxng(
  query: string,
  baseUrl: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!baseUrl) throw new Error('SearXNG requires searxngUrl or MCP_SEARXNG_URL');

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    pageno: '1',
  });

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/search?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: { title: string; url: string; content: string }[];
  };

  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

// ─── Multi-Search Aggregation ───────────────────────────────

type SearchProviderName =
  | 'duckduckgo'
  | 'serpapi'
  | 'tavily'
  | 'brave'
  | 'bing'
  | 'exa'
  | 'searxng';

interface MultiSearchResultItem extends SearchResult {
  sources: SearchProviderName[];
  score: number;
}

function getAvailableProviders(config: McpServiceConfig): SearchProviderName[] {
  const available: SearchProviderName[] = ['duckduckgo']; // always available (no key)

  if (config.webSearchApiKey) {
    // The shared key works for whichever single-provider is configured
    if (config.webSearchProvider === 'serpapi') available.push('serpapi');
    if (config.webSearchProvider === 'tavily') available.push('tavily');
  }
  if (config.braveSearchApiKey) available.push('brave');
  if (config.bingSearchApiKey) available.push('bing');
  if (config.exaApiKey) available.push('exa');
  if (config.searxngUrl) available.push('searxng');

  return available;
}

async function searchByProvider(
  provider: SearchProviderName,
  query: string,
  config: McpServiceConfig,
  maxResults: number
): Promise<{ provider: SearchProviderName; results: SearchResult[] }> {
  let results: SearchResult[];
  switch (provider) {
    case 'duckduckgo':
      results = await searchDuckDuckGo(query, maxResults);
      break;
    case 'serpapi':
      results = await searchSerpApi(query, config.webSearchApiKey ?? '', maxResults);
      break;
    case 'tavily':
      results = await searchTavily(query, config.webSearchApiKey ?? '', maxResults);
      break;
    case 'brave':
      results = await searchBrave(query, config.braveSearchApiKey ?? '', maxResults);
      break;
    case 'bing':
      results = await searchBing(query, config.bingSearchApiKey ?? '', maxResults);
      break;
    case 'exa':
      results = await searchExa(query, config.exaApiKey ?? '', maxResults);
      break;
    case 'searxng':
      results = await searchSearxng(query, config.searxngUrl ?? '', maxResults);
      break;
    default:
      results = [];
  }
  return { provider, results };
}

/** Deduplicate results by URL, merge sources, rank by cross-source agreement. */
function aggregateResults(
  providerResults: { provider: SearchProviderName; results: SearchResult[] }[]
): MultiSearchResultItem[] {
  const byUrl = new Map<string, MultiSearchResultItem>();

  for (const { provider, results } of providerResults) {
    for (const r of results) {
      const key = r.url.replace(/\/$/, '').toLowerCase();
      const existing = byUrl.get(key);
      if (existing) {
        existing.sources.push(provider);
        existing.score += 1;
        // Keep the longer snippet
        if (r.snippet.length > existing.snippet.length) {
          existing.snippet = r.snippet;
        }
      } else {
        byUrl.set(key, { ...r, sources: [provider], score: 1 });
      }
    }
  }

  // Sort: cross-source agreement first, then alphabetical by title for stability
  return [...byUrl.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** Try to call a connected MCP search server (e.g. Brave Search, Exa) via the core API. */
async function searchViaMcpServer(
  client: { post: <T>(path: string, body?: unknown) => Promise<T> } | null,
  serverName: string,
  toolName: string,
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (!client) return [];
  try {
    const res = await client.post<{
      content?: { type: string; text: string }[];
    }>('/api/v1/mcp/tools/call', {
      serverName,
      toolName,
      arguments: { query, count: maxResults, max_results: maxResults },
    });
    // Parse MCP tool response — most search MCP servers return JSON in text content
    const text = res.content?.[0]?.text;
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as
        | SearchResult[]
        | { results?: SearchResult[]; web?: { results?: SearchResult[] } };
      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxResults).map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.snippet ?? '',
        }));
      }
      const arr =
        (parsed as { results?: SearchResult[] }).results ??
        (parsed as { web?: { results?: SearchResult[] } }).web?.results ??
        [];
      return arr.slice(0, maxResults).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.snippet ?? (r as unknown as Record<string, string>).description ?? '',
      }));
    } catch {
      // Not JSON — return as a single snippet
      return [{ title: 'MCP result', url: '', snippet: text.slice(0, 500) }];
    }
  } catch {
    return []; // Server unavailable — skip silently
  }
}

/** Well-known MCP search server names and their primary search tool. */
const MCP_SEARCH_SERVERS: { name: string; tool: string; label: SearchProviderName | string }[] = [
  { name: 'Brave Search', tool: 'brave_web_search', label: 'brave' },
  { name: 'Exa', tool: 'search', label: 'exa' },
];

// ─── Tool Registration ──────────────────────────────────────

export function registerWebTools(
  server: McpServer,
  config: McpServiceConfig,
  middleware: ToolMiddleware,
  client?: { post: <T>(path: string, body?: unknown) => Promise<T> } | null
): void {
  const webLimiter = new WebRateLimiter(config.webRateLimitPerMinute);
  const proxyManager = config.proxyEnabled ? new ProxyManager(config) : null;

  // 1. web_scrape_markdown — convert webpage to clean LLM-ready markdown
  server.registerTool(
    'web_scrape_markdown',
    {
      description:
        'Scrape a webpage and convert to clean LLM-ready markdown (requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        url: z.string().describe('URL to scrape'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe('ISO 3166-1 alpha-2 country code for geo-targeting (e.g., US, DE)'),
      },
    },
    wrapToolHandler('web_scrape_markdown', middleware, async (args) => {
      const { body, finalUrl, contentType, markdownTokens } = await safeFetch(
        args.url,
        config,
        webLimiter,
        proxyManager,
        { country: args.country, acceptMarkdown: true }
      );
      // Use body as-is if the server already sent markdown; otherwise convert
      const rawMd = contentType.includes('text/markdown') ? body : htmlToMarkdown(body);
      const { metadata, body: mdBody } = parseFrontMatter(rawMd);
      const tokenCount = markdownTokens ?? estimateTokens(mdBody);

      let header = `# Scraped: ${finalUrl}\n\n`;
      if (Object.keys(metadata).length > 0) {
        header += `**Page metadata:** ${JSON.stringify(metadata)}\n\n`;
      }
      const output = truncateOutput(`${header}${mdBody}\n\n*Token estimate: ${tokenCount}*`);
      return textResponse(output);
    })
  );

  // 2. web_scrape_html — raw HTML extraction with optional CSS selector
  server.registerTool(
    'web_scrape_html',
    {
      description:
        'Scrape raw HTML from a webpage, optionally filtering by CSS selector (requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        url: z.string().describe('URL to scrape'),
        selector: z
          .string()
          .optional()
          .describe('CSS selector to extract (basic: #id, .class, tag)'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe('ISO 3166-1 alpha-2 country code for geo-targeting (e.g., US, DE)'),
      },
    },
    wrapToolHandler('web_scrape_html', middleware, async (args) => {
      const { body, finalUrl } = await safeFetch(args.url, config, webLimiter, proxyManager, {
        country: args.country,
        acceptMarkdown: false,
      });
      const html = args.selector ? extractWithSelector(body, args.selector) : body;
      const output = truncateOutput(html);
      return textResponse(`<!-- Source: ${finalUrl} -->\n${output}`);
    })
  );

  // 3. web_scrape_batch — parallel multi-URL scraping
  server.registerTool(
    'web_scrape_batch',
    {
      description:
        'Scrape multiple URLs in parallel and return markdown (max 10 URLs, requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        urls: z.array(z.string()).min(1).max(MAX_BATCH_URLS).describe('URLs to scrape (max 10)'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe('ISO 3166-1 alpha-2 country code for geo-targeting (e.g., US, DE)'),
      },
    },
    wrapToolHandler('web_scrape_batch', middleware, async (args) => {
      const results = await Promise.allSettled(
        args.urls.map(async (url: string) => {
          const { body, finalUrl } = await safeFetch(url, config, webLimiter, proxyManager, {
            country: args.country,
            acceptMarkdown: false,
          });
          const markdown = htmlToMarkdown(body);
          return { url: finalUrl, markdown };
        })
      );

      const output = results
        .map((r, i) => {
          if (r.status === 'fulfilled') {
            return `## ${r.value.url}\n\n${r.value.markdown}`;
          }
          return `## ${args.urls[i]}\n\n**Error:** ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
        })
        .join('\n\n---\n\n');

      return textResponse(truncateOutput(output));
    })
  );

  // 4. web_extract_structured — structured JSON extraction from pages
  server.registerTool(
    'web_extract_structured',
    {
      description:
        'Extract structured data from a webpage as JSON based on a schema description (requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        url: z.string().describe('URL to extract data from'),
        fields: z
          .array(
            z.object({
              name: z.string().describe('Field name'),
              selector: z.string().optional().describe('CSS selector hint'),
              description: z.string().describe('What this field should contain'),
            })
          )
          .describe('Fields to extract'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe('ISO 3166-1 alpha-2 country code for geo-targeting (e.g., US, DE)'),
      },
    },
    wrapToolHandler('web_extract_structured', middleware, async (args) => {
      const { body, finalUrl } = await safeFetch(args.url, config, webLimiter, proxyManager, {
        country: args.country,
        acceptMarkdown: false,
      });
      const text = stripHtmlTags(body);

      // Best-effort extraction based on field descriptions
      const extracted: Record<string, string> = { _sourceUrl: finalUrl };
      for (const field of args.fields) {
        if (field.selector) {
          const selected = extractWithSelector(body, field.selector);
          extracted[field.name] = stripHtmlTags(selected).slice(0, 2000);
        } else {
          // Return raw text for AI to parse
          extracted[field.name] = `[Extract "${field.description}" from page text]`;
        }
      }

      // Include a text summary for AI processing
      extracted._pageText = text.slice(0, 10000);

      return textResponse(truncateOutput(JSON.stringify(extracted, null, 2)));
    })
  );

  // 5. web_search — web search with configurable backend
  server.registerTool(
    'web_search',
    {
      description:
        'Search the web using configurable search backend (requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        query: z.string().min(1).max(500).describe('Search query'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe('Maximum results to return'),
      },
    },
    wrapToolHandler('web_search', middleware, async (args) => {
      const rate = webLimiter.check();
      if (!rate.allowed) {
        throw new Error(`Web rate limit exceeded. Retry after ${rate.retryAfterMs}ms.`);
      }

      const results = await performSearch(args.query, config, args.maxResults);

      const output =
        results.length === 0
          ? 'No results found.'
          : results
              .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
              .join('\n\n');

      return textResponse(
        `## Search: "${args.query}"\n\nProvider: ${config.webSearchProvider}\n\n${output}`
      );
    })
  );

  // 7. web_fetch_markdown — dedicated lean markdown fetch with front matter passthrough
  server.registerTool(
    'web_fetch_markdown',
    {
      description:
        'Fetch a single URL as markdown, honouring Content-Signal and surfacing YAML front matter and token counts (requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        url: z.string().describe('URL to fetch as markdown'),
      },
    },
    wrapToolHandler('web_fetch_markdown', middleware, async (args) => {
      const { body, finalUrl, contentType, markdownTokens } = await safeFetch(
        args.url,
        config,
        webLimiter,
        null,
        { acceptMarkdown: true }
      );
      const rawMd = contentType.includes('text/markdown') ? body : htmlToMarkdown(body);
      const { metadata: upstreamMeta, body: mdBody } = parseFrontMatter(rawMd);
      const tokenCount = markdownTokens ?? estimateTokens(mdBody);

      const frontMatter = buildFrontMatter({
        source: finalUrl,
        tokens: tokenCount,
        ...upstreamMeta,
      });
      const output = truncateOutput(frontMatter + mdBody);
      return textResponse(output);
    })
  );

  // 6. web_search_batch — batch search for research tasks
  server.registerTool(
    'web_search_batch',
    {
      description:
        'Run multiple search queries in parallel for research (max 5 queries, requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        queries: z
          .array(z.string().min(1).max(500))
          .min(1)
          .max(MAX_BATCH_QUERIES)
          .describe('Search queries (max 5)'),
        maxResultsPerQuery: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Max results per query'),
      },
    },
    wrapToolHandler('web_search_batch', middleware, async (args) => {
      const results = await Promise.allSettled(
        args.queries.map(async (query: string) => {
          const rate = webLimiter.check();
          if (!rate.allowed) {
            throw new Error('Web rate limit exceeded');
          }
          const searchResults = await performSearch(query, config, args.maxResultsPerQuery);
          return { query, results: searchResults };
        })
      );

      const output = results
        .map((r, i) => {
          if (r.status === 'fulfilled') {
            const { query, results: searchResults } = r.value;
            const items =
              searchResults.length === 0
                ? '  No results found.'
                : searchResults
                    .map((sr, j) => `  ${j + 1}. **${sr.title}** — ${sr.url}\n     ${sr.snippet}`)
                    .join('\n');
            return `## "${query}"\n\n${items}`;
          }
          return `## "${args.queries[i]}"\n\n  **Error:** ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
        })
        .join('\n\n---\n\n');

      return textResponse(truncateOutput(output));
    })
  );

  // 8. web_search_multi — aggregated multi-provider search
  server.registerTool(
    'web_search_multi',
    {
      description:
        'Search across multiple search engines simultaneously and return deduplicated, ranked results. ' +
        'Fans out to all configured providers (DuckDuckGo, Brave, Bing, Exa, SerpAPI, Tavily, SearXNG) ' +
        'plus any connected MCP search servers. Results are ranked by cross-source agreement. ' +
        '(requires MCP_EXPOSE_WEB=true)',
      inputSchema: {
        query: z.string().min(1).max(500).describe('Search query'),
        maxResultsPerProvider: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Maximum results per provider'),
        providers: z
          .array(z.enum(['duckduckgo', 'serpapi', 'tavily', 'brave', 'bing', 'exa', 'searxng']))
          .optional()
          .describe(
            'Specific providers to query (defaults to all configured). ' +
              'Connected MCP search servers (Brave Search, Exa) are always included when available.'
          ),
      },
    },
    wrapToolHandler('web_search_multi', middleware, async (args) => {
      const rate = webLimiter.check();
      if (!rate.allowed) {
        throw new Error(`Web rate limit exceeded. Retry after ${rate.retryAfterMs}ms.`);
      }

      const allAvailable = getAvailableProviders(config);
      const requested: SearchProviderName[] = args.providers ?? allAvailable;
      // Only query providers that are actually configured
      const providers = requested.filter((p) => allAvailable.includes(p));

      // Fan out to all native providers in parallel
      const nativePromises = providers.map((p) =>
        searchByProvider(p, args.query, config, args.maxResultsPerProvider).catch(
          (err: unknown) => ({
            provider: p,
            results: [] as SearchResult[],
            error: err instanceof Error ? err.message : String(err),
          })
        )
      );

      // Also query connected MCP search servers (Brave Search, Exa prebuilts)
      const mcpPromises = MCP_SEARCH_SERVERS.map(async (srv) => {
        const results = await searchViaMcpServer(
          client ?? null,
          srv.name,
          srv.tool,
          args.query,
          args.maxResultsPerProvider
        );
        if (results.length === 0) return null;
        return { provider: srv.label as SearchProviderName, results };
      });

      const [nativeResults, ...mcpResults] = await Promise.all([
        Promise.all(nativePromises),
        ...mcpPromises,
      ]);

      // Merge native + MCP results
      const allResults: { provider: SearchProviderName; results: SearchResult[] }[] = [];
      const errors: string[] = [];

      for (const r of nativeResults) {
        if ('error' in r) {
          errors.push(`${r.provider}: ${r.error}`);
        } else {
          allResults.push(r);
        }
      }

      for (const r of mcpResults) {
        if (r) {
          // Avoid duplicating if we already have native results from this provider
          if (!allResults.some((nr) => nr.provider === r.provider)) {
            allResults.push(r);
          }
        }
      }

      const aggregated = aggregateResults(allResults);
      const providerNames = allResults.map((r) => r.provider);

      let output = `## Multi-Search: "${args.query}"\n\n`;
      output += `**Providers queried:** ${providerNames.join(', ') || 'none'}\n`;
      output += `**Total unique results:** ${aggregated.length}\n`;
      if (errors.length > 0) {
        output += `**Errors:** ${errors.join('; ')}\n`;
      }
      output += '\n';

      if (aggregated.length === 0) {
        output += 'No results found across any provider.';
      } else {
        output += aggregated
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}**\n` +
              `   ${r.url}\n` +
              `   ${r.snippet}\n` +
              `   _Sources: ${r.sources.join(', ')}${r.score > 1 ? ` (${r.score}× cross-referenced)` : ''}_`
          )
          .join('\n\n');
      }

      return textResponse(truncateOutput(output));
    })
  );
}

// Exported for testing
export {
  validateUrl,
  WebRateLimiter,
  truncateOutput,
  htmlToMarkdown,
  stripHtmlTags,
  safeFetch,
  parseFrontMatter,
  ContentSignalBlockedError,
  estimateTokens,
  searchBrave,
  searchBing,
  searchExa,
  searchSearxng,
  getAvailableProviders,
  aggregateResults,
  searchByProvider,
  searchViaMcpServer,
  MCP_SEARCH_SERVERS,
};
export type { SearchResult, MultiSearchResultItem, SearchProviderName };
