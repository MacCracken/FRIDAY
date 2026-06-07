/**
 * Web Tools — unit tests for URL validation, SSRF blocking, output truncation, and rate limiting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateUrl,
  WebRateLimiter,
  truncateOutput,
  stripHtmlTags,
  safeFetch,
  parseFrontMatter,
  buildFrontMatter,
  ContentSignalBlockedError,
  estimateTokens,
  getAvailableProviders,
  aggregateResults,
  searchBrave,
  searchBing,
  searchExa,
  searchSearxng,
  searchViaMcpServer,
  MCP_SEARCH_SERVERS,
} from './web-tools.js';
import type { SearchProviderName } from './web-tools.js';
import { registerWebTools } from './web-tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProxyManager } from './proxy-manager.js';
import type { McpServiceConfig } from '@secureyeoman/shared';

function makeConfig(overrides: Partial<McpServiceConfig> = {}): McpServiceConfig {
  return {
    enabled: true,
    port: 3001,
    host: '127.0.0.1',
    transport: 'streamable-http',
    autoRegister: true,
    coreUrl: 'http://127.0.0.1:18789',
    exposeFilesystem: false,
    allowedPaths: [],
    exposeWeb: true,
    allowedUrls: [],
    webRateLimitPerMinute: 10,
    exposeWebScraping: true,
    exposeWebSearch: true,
    webSearchProvider: 'duckduckgo',
    rateLimitPerTool: 30,
    logLevel: 'info',
    ...overrides,
  } as McpServiceConfig;
}

describe('validateUrl', () => {
  const config = makeConfig();

  it('allows valid https URLs', () => {
    const url = validateUrl('https://example.com/page', config);
    expect(url.hostname).toBe('example.com');
  });

  it('allows valid http URLs', () => {
    const url = validateUrl('http://example.com', config);
    expect(url.protocol).toBe('http:');
  });

  it('blocks file:// protocol', () => {
    expect(() => validateUrl('file:///etc/passwd', config)).toThrow('Protocol "file:" not allowed');
  });

  it('blocks ftp:// protocol', () => {
    expect(() => validateUrl('ftp://example.com', config)).toThrow('Protocol "ftp:" not allowed');
  });

  it('blocks invalid URLs', () => {
    expect(() => validateUrl('not-a-url', config)).toThrow('Invalid URL');
  });

  // SSRF blocking
  it('blocks localhost', () => {
    expect(() => validateUrl('http://localhost/admin', config)).toThrow('Hostname blocked');
  });

  it('blocks 127.0.0.1', () => {
    expect(() => validateUrl('http://127.0.0.1/admin', config)).toThrow('IP address blocked');
  });

  it('blocks 10.x private IPs', () => {
    expect(() => validateUrl('http://10.0.0.1/internal', config)).toThrow('IP address blocked');
  });

  it('blocks 172.16.x private IPs', () => {
    expect(() => validateUrl('http://172.16.0.1/internal', config)).toThrow('IP address blocked');
  });

  it('blocks 192.168.x private IPs', () => {
    expect(() => validateUrl('http://192.168.1.1/admin', config)).toThrow('IP address blocked');
  });

  it('blocks cloud metadata endpoint (169.254.169.254)', () => {
    expect(() => validateUrl('http://169.254.169.254/latest/meta-data/', config)).toThrow(
      'IP address blocked'
    );
  });

  it('blocks metadata.google.internal', () => {
    expect(() => validateUrl('http://metadata.google.internal', config)).toThrow(
      'Hostname blocked'
    );
  });

  // Allowlist
  it('enforces domain allowlist when configured', () => {
    const restricted = makeConfig({ allowedUrls: ['example.com'] });
    expect(() => validateUrl('https://evil.com/data', restricted)).toThrow(
      'Domain not in allowlist'
    );
    // Allowed domain works
    const url = validateUrl('https://example.com/page', restricted);
    expect(url.hostname).toBe('example.com');
  });

  it('allows subdomains of allowlisted domains', () => {
    const restricted = makeConfig({ allowedUrls: ['example.com'] });
    const url = validateUrl('https://api.example.com/data', restricted);
    expect(url.hostname).toBe('api.example.com');
  });
});

describe('WebRateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = new WebRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check().allowed).toBe(true);
    }
  });

  it('blocks requests exceeding the limit', () => {
    const limiter = new WebRateLimiter(3);
    limiter.check();
    limiter.check();
    limiter.check();
    const result = limiter.check();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('truncateOutput', () => {
  it('returns short text unchanged', () => {
    expect(truncateOutput('hello')).toBe('hello');
  });

  it('truncates text exceeding 500KB', () => {
    const large = 'x'.repeat(600 * 1024);
    const result = truncateOutput(large);
    expect(result).toContain('[OUTPUT TRUNCATED');
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(500 * 1024 + 200);
  });
});

describe('stripHtmlTags', () => {
  it('strips script tags', () => {
    expect(stripHtmlTags('<script>alert(1)</script>hello')).toBe('hello');
  });

  it('strips style tags', () => {
    expect(stripHtmlTags('<style>.x{}</style>hello')).toBe('hello');
  });

  it('strips regular tags', () => {
    expect(stripHtmlTags('<p>hello <b>world</b></p>')).toContain('hello');
    expect(stripHtmlTags('<p>hello <b>world</b></p>')).toContain('world');
  });
});

describe('parseFrontMatter', () => {
  it('parses well-formed YAML front matter block', () => {
    const content = '---\ntitle: Hello\nauthor: World\n---\n\nBody text here.';
    const { metadata, body } = parseFrontMatter(content);
    expect(metadata.title).toBe('Hello');
    expect(metadata.author).toBe('World');
    expect(body).toBe('Body text here.');
  });

  it('returns full content as body when no front matter', () => {
    const content = 'Just plain text with no front matter.';
    const { metadata, body } = parseFrontMatter(content);
    expect(metadata).toEqual({});
    expect(body).toBe(content);
  });

  it('returns empty metadata for unclosed front matter (no closing ---)', () => {
    const content = '---\ntitle: Unclosed\nno closing block here';
    const { metadata, body } = parseFrontMatter(content);
    expect(metadata).toEqual({});
    expect(body).toBe(content);
  });

  it('strips surrounding quotes from values', () => {
    const content = '---\nname: "quoted value"\nother: \'single quoted\'\n---\n\nBody.';
    const { metadata } = parseFrontMatter(content);
    expect(metadata.name).toBe('quoted value');
    expect(metadata.other).toBe('single quoted');
  });
});

describe('buildFrontMatter', () => {
  it('produces --- delimited block with correct key: value lines', () => {
    const result = buildFrontMatter({ title: 'Test', author: 'Alice' });
    expect(result).toContain('---');
    expect(result).toContain('title: Test');
    expect(result).toContain('author: Alice');
  });

  it('skips undefined and empty-string fields', () => {
    const result = buildFrontMatter({ title: 'Test', empty: '', missing: undefined });
    expect(result).not.toContain('empty:');
    expect(result).not.toContain('missing:');
  });

  it('wraps values containing colons in double quotes', () => {
    const result = buildFrontMatter({ url: 'https://example.com/path' });
    expect(result).toContain('"https://example.com/path"');
  });
});

describe('ContentSignalBlockedError', () => {
  it('is instanceof Error with correct name', () => {
    const err = new ContentSignalBlockedError('https://example.com');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContentSignalBlockedError');
    expect(err.message).toContain('ai-input=no');
    expect(err.message).toContain('MCP_RESPECT_CONTENT_SIGNAL=false');
  });
});

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('safeFetch Content-Signal handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ContentSignalBlockedError when Content-Signal: ai-input=no and respectContentSignal is true', async () => {
    const mockHeaders = new Headers({
      'content-type': 'text/html',
      'content-signal': 'ai-input=no',
    });
    const mockResponse = {
      status: 200,
      ok: true,
      headers: mockHeaders,
      text: vi.fn().mockResolvedValue('<html>blocked</html>'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const config = makeConfig({ respectContentSignal: true });
    const limiter = new WebRateLimiter(100);
    await expect(
      safeFetch('https://example.com', config, limiter, null, { acceptMarkdown: true })
    ).rejects.toThrow(ContentSignalBlockedError);
  });

  it('does NOT throw when respectContentSignal is false', async () => {
    const mockHeaders = new Headers({
      'content-type': 'text/html',
      'content-signal': 'ai-input=no',
    });
    const mockResponse = {
      status: 200,
      ok: true,
      headers: mockHeaders,
      text: vi.fn().mockResolvedValue('<html>content</html>'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const config = makeConfig({ respectContentSignal: false });
    const limiter = new WebRateLimiter(100);
    const result = await safeFetch('https://example.com', config, limiter, null, {
      acceptMarkdown: true,
    });
    expect(result.body).toBe('<html>content</html>');
  });

  it('surfaces markdownTokens from x-markdown-tokens header', async () => {
    const mockHeaders = new Headers({
      'content-type': 'text/markdown',
      'x-markdown-tokens': '42',
    });
    const mockResponse = {
      status: 200,
      ok: true,
      headers: mockHeaders,
      text: vi.fn().mockResolvedValue('# Hello\n\nBody.'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const config = makeConfig();
    const limiter = new WebRateLimiter(100);
    const result = await safeFetch('https://example.com', config, limiter, null, {
      acceptMarkdown: true,
    });
    expect(result.markdownTokens).toBe(42);
  });

  it('returns null markdownTokens when header is absent', async () => {
    const mockHeaders = new Headers({ 'content-type': 'text/html' });
    const mockResponse = {
      status: 200,
      ok: true,
      headers: mockHeaders,
      text: vi.fn().mockResolvedValue('<p>Hi</p>'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const config = makeConfig();
    const limiter = new WebRateLimiter(100);
    const result = await safeFetch('https://example.com', config, limiter, null);
    expect(result.markdownTokens).toBeNull();
  });
});

describe('web_fetch_markdown registration', () => {
  it('registers web_fetch_markdown tool without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const config = makeConfig();
    const middleware = {
      rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }) },
      inputValidator: { validate: vi.fn().mockReturnValue({ blocked: false }) },
      auditLogger: { wrap: vi.fn().mockImplementation((_n, _a, fn) => fn()) },
      secretRedactor: { redact: vi.fn().mockImplementation((r) => r) },
    } as unknown as import('./index.js').ToolMiddleware;
    expect(() => registerWebTools(server, config, middleware)).not.toThrow();
  });
});

describe('safeFetch proxy integration', () => {
  it('safeFetch works identically when proxyManager is null', () => {
    // validateUrl should still work for public URLs without proxy
    const config = makeConfig();
    const url = validateUrl('https://example.com', config);
    expect(url.hostname).toBe('example.com');
  });

  it('SSRF still blocks private IPs when proxy is enabled', () => {
    const config = makeConfig({ proxyEnabled: true } as Partial<McpServiceConfig>);
    expect(() => validateUrl('http://169.254.169.254/latest/meta-data/', config)).toThrow(
      'IP address blocked'
    );
    expect(() => validateUrl('http://127.0.0.1/admin', config)).toThrow('IP address blocked');
    expect(() => validateUrl('http://10.0.0.1/internal', config)).toThrow('IP address blocked');
  });

  it('country option passes through to proxy buildFetchOptions', () => {
    const config = makeConfig({
      proxyEnabled: true,
      proxyProviders: ['scrapingbee'],
      proxyScrapingbeeKey: 'test-key',
      proxyStrategy: 'round-robin',
    } as Partial<McpServiceConfig>);
    const pm = new ProxyManager(config);
    const result = pm.buildFetchOptions('https://example.com', { country: 'US' });
    expect(result).not.toBeNull();
    expect(result!.url).toContain('country_code=US');
  });
});

// ─── Multi-Search Tests ─────────────────────────────────────

describe('getAvailableProviders', () => {
  it('always includes duckduckgo', () => {
    const config = makeConfig();
    const providers = getAvailableProviders(config);
    expect(providers).toContain('duckduckgo');
  });

  it('includes brave when braveSearchApiKey is set', () => {
    const config = makeConfig({ braveSearchApiKey: 'test-key' } as Partial<McpServiceConfig>);
    const providers = getAvailableProviders(config);
    expect(providers).toContain('brave');
  });

  it('includes bing when bingSearchApiKey is set', () => {
    const config = makeConfig({ bingSearchApiKey: 'test-key' } as Partial<McpServiceConfig>);
    const providers = getAvailableProviders(config);
    expect(providers).toContain('bing');
  });

  it('includes exa when exaApiKey is set', () => {
    const config = makeConfig({ exaApiKey: 'test-key' } as Partial<McpServiceConfig>);
    const providers = getAvailableProviders(config);
    expect(providers).toContain('exa');
  });

  it('includes searxng when searxngUrl is set', () => {
    const config = makeConfig({ searxngUrl: 'http://localhost:8080' } as Partial<McpServiceConfig>);
    const providers = getAvailableProviders(config);
    expect(providers).toContain('searxng');
  });

  it('includes serpapi when webSearchProvider is serpapi and key set', () => {
    const config = makeConfig({
      webSearchProvider: 'serpapi',
      webSearchApiKey: 'test-key',
    } as Partial<McpServiceConfig>);
    const providers = getAvailableProviders(config);
    expect(providers).toContain('serpapi');
  });

  it('does not include brave without key', () => {
    const config = makeConfig();
    const providers = getAvailableProviders(config);
    expect(providers).not.toContain('brave');
  });
});

describe('aggregateResults', () => {
  it('deduplicates results by URL and merges sources', () => {
    const providerResults = [
      {
        provider: 'duckduckgo' as SearchProviderName,
        results: [
          { title: 'Example', url: 'https://example.com', snippet: 'Short' },
          { title: 'Other', url: 'https://other.com', snippet: 'Other snippet' },
        ],
      },
      {
        provider: 'brave' as SearchProviderName,
        results: [
          {
            title: 'Example Page',
            url: 'https://example.com/',
            snippet: 'A longer snippet from Brave search',
          },
        ],
      },
    ];

    const aggregated = aggregateResults(providerResults);

    // example.com appears in both providers — should be merged
    const example = aggregated.find((r) => r.url.includes('example.com'));
    expect(example).toBeDefined();
    expect(example!.sources).toContain('duckduckgo');
    expect(example!.sources).toContain('brave');
    expect(example!.score).toBe(2);
    // Keeps the longer snippet
    expect(example!.snippet).toBe('A longer snippet from Brave search');
  });

  it('ranks cross-referenced results higher', () => {
    const providerResults = [
      {
        provider: 'duckduckgo' as SearchProviderName,
        results: [
          { title: 'Unique DDG', url: 'https://unique.com', snippet: 'Only DDG' },
          { title: 'Shared', url: 'https://shared.com', snippet: 'DDG version' },
        ],
      },
      {
        provider: 'tavily' as SearchProviderName,
        results: [{ title: 'Shared', url: 'https://shared.com', snippet: 'Tavily version' }],
      },
    ];

    const aggregated = aggregateResults(providerResults);
    // Shared result (score 2) should come before unique (score 1)
    expect(aggregated[0]!.url).toContain('shared.com');
    expect(aggregated[0]!.score).toBe(2);
  });

  it('handles empty provider results', () => {
    const aggregated = aggregateResults([]);
    expect(aggregated).toEqual([]);
  });
});

describe('searchBrave', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without API key', async () => {
    await expect(searchBrave('test', '', 5)).rejects.toThrow('braveSearchApiKey');
  });

  it('parses Brave API response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            { title: 'Brave Result', url: 'https://brave.com', description: 'Found via Brave' },
          ],
        },
      }),
    } as unknown as Response);

    const results = await searchBrave('test query', 'brave-key', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Brave Result');
    expect(results[0]!.snippet).toBe('Found via Brave');

    // Verify correct headers
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[1]?.headers).toHaveProperty('X-Subscription-Token', 'brave-key');
  });
});

describe('searchBing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without API key', async () => {
    await expect(searchBing('test', '', 5)).rejects.toThrow('bingSearchApiKey');
  });

  it('parses Bing API response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        webPages: {
          value: [{ name: 'Bing Result', url: 'https://bing.com', snippet: 'Found via Bing' }],
        },
      }),
    } as unknown as Response);

    const results = await searchBing('test query', 'bing-key', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Bing Result');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[1]?.headers).toHaveProperty('Ocp-Apim-Subscription-Key', 'bing-key');
  });
});

describe('searchExa', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without API key', async () => {
    await expect(searchExa('test', '', 5)).rejects.toThrow('exaApiKey');
  });

  it('parses Exa API response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [{ title: 'Exa Result', url: 'https://exa.ai', text: 'Neural search result' }],
      }),
    } as unknown as Response);

    const results = await searchExa('test query', 'exa-key', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Exa Result');
    expect(results[0]!.snippet).toBe('Neural search result');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[1]?.headers).toHaveProperty('x-api-key', 'exa-key');
    // Verify POST body
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.type).toBe('neural');
    expect(body.useAutoprompt).toBe(true);
  });
});

describe('searchSearxng', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without URL', async () => {
    await expect(searchSearxng('test', '', 5)).rejects.toThrow('searxngUrl');
  });

  it('parses SearXNG JSON response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          { title: 'SearXNG Result', url: 'https://searxng.local', content: 'Self-hosted search' },
        ],
      }),
    } as unknown as Response);

    const results = await searchSearxng('test query', 'http://localhost:8080', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('SearXNG Result');
    expect(results[0]!.snippet).toBe('Self-hosted search');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0] as string).toContain('localhost:8080/search');
    expect(fetchCall[0] as string).toContain('format=json');
  });

  it('strips trailing slash from base URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as Response);

    await searchSearxng('test', 'http://localhost:8080/', 5);
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0] as string).not.toContain('//search');
  });
});

describe('searchViaMcpServer', () => {
  it('returns empty array when client is null', async () => {
    const results = await searchViaMcpServer(null, 'Brave Search', 'brave_web_search', 'test', 5);
    expect(results).toEqual([]);
  });

  it('returns empty array when MCP call fails', async () => {
    const client = { post: vi.fn().mockRejectedValue(new Error('Server unavailable')) };
    const results = await searchViaMcpServer(client, 'Brave Search', 'brave_web_search', 'test', 5);
    expect(results).toEqual([]);
  });

  it('parses JSON array response from MCP server', async () => {
    const client = {
      post: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { title: 'MCP Brave', url: 'https://example.com', snippet: 'via MCP' },
            ]),
          },
        ],
      }),
    };

    const results = await searchViaMcpServer(client, 'Brave Search', 'brave_web_search', 'test', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('MCP Brave');
  });

  it('parses nested { results: [] } response from MCP server', async () => {
    const client = {
      post: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [{ title: 'Nested', url: 'https://nested.com', snippet: 'Nested result' }],
            }),
          },
        ],
      }),
    };

    const results = await searchViaMcpServer(client, 'Exa', 'search', 'test', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Nested');
  });

  it('falls back to raw text snippet when response is not JSON', async () => {
    const client = {
      post: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Plain text result from MCP' }],
      }),
    };

    const results = await searchViaMcpServer(client, 'Exa', 'search', 'test', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.snippet).toBe('Plain text result from MCP');
  });
});

describe('MCP_SEARCH_SERVERS', () => {
  it('contains Brave Search and Exa entries', () => {
    expect(MCP_SEARCH_SERVERS.find((s) => s.name === 'Brave Search')).toBeDefined();
    expect(MCP_SEARCH_SERVERS.find((s) => s.name === 'Exa')).toBeDefined();
  });

  it('each entry has name, tool, and label', () => {
    for (const srv of MCP_SEARCH_SERVERS) {
      expect(srv.name).toBeTruthy();
      expect(srv.tool).toBeTruthy();
      expect(srv.label).toBeTruthy();
    }
  });
});

describe('web_search_multi registration', () => {
  it('registers web_search_multi tool without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const config = makeConfig();
    const middleware = {
      rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }) },
      inputValidator: { validate: vi.fn().mockReturnValue({ blocked: false }) },
      auditLogger: { wrap: vi.fn().mockImplementation((_n, _a, fn) => fn()) },
      secretRedactor: { redact: vi.fn().mockImplementation((r) => r) },
    } as unknown as import('./index.js').ToolMiddleware;
    expect(() => registerWebTools(server, config, middleware)).not.toThrow();
  });
});

// ─── Additional Coverage ──────────────────────────────────────────────────────

describe('validateUrl — additional SSRF vectors', () => {
  const config = makeConfig();

  it('blocks 0.0.0.0', () => {
    expect(() => {
      validateUrl('http://0.0.0.0/path', config);
    }).toThrow();
  });

  it('allows standard external HTTPS URLs', () => {
    const url = validateUrl('https://api.example.com/v1/data', config);
    expect(url.hostname).toBe('api.example.com');
  });

  it('allows URLs with ports', () => {
    const url = validateUrl('https://example.com:8443/api', config);
    expect(url.port).toBe('8443');
  });

  it('blocks data: URLs', () => {
    expect(() => {
      validateUrl('data:text/html,<h1>test</h1>', config);
    }).toThrow();
  });

  it('blocks javascript: URLs', () => {
    expect(() => {
      validateUrl('javascript:alert(1)', config);
    }).toThrow();
  });

  it('blocks decimal-encoded loopback (2130706433 = 127.0.0.1)', () => {
    expect(() => validateUrl('http://2130706433/', config)).toThrow('blocked');
  });

  it('blocks hex-encoded loopback (0x7f000001)', () => {
    expect(() => validateUrl('http://0x7f000001/', config)).toThrow('blocked');
  });

  it('blocks octal-encoded loopback (017700000001)', () => {
    expect(() => validateUrl('http://017700000001/', config)).toThrow('blocked');
  });

  it('blocks decimal-encoded cloud metadata (2852039166 = 169.254.169.254)', () => {
    expect(() => validateUrl('http://2852039166/latest/meta-data/', config)).toThrow('blocked');
  });

  it('blocks IPv4-mapped IPv6 metadata address', () => {
    expect(() => validateUrl('http://[::ffff:169.254.169.254]/', config)).toThrow('blocked');
  });
});

// WebRateLimiter additional tests covered by existing suite

describe('truncateOutput — edge cases', () => {
  it('handles empty string', () => {
    expect(truncateOutput('')).toBe('');
  });

  it('handles string at exactly the limit', () => {
    const str = 'x'.repeat(512 * 1024);
    const result = truncateOutput(str);
    expect(result.length).toBeLessThanOrEqual(512 * 1024 + 100); // some slack for truncation message
  });
});

describe('stripHtmlTags — additional cases', () => {
  it('preserves text content', () => {
    expect(stripHtmlTags('<p>Hello <b>world</b></p>')).toContain('Hello');
    expect(stripHtmlTags('<p>Hello <b>world</b></p>')).toContain('world');
  });

  it('handles nested tags', () => {
    expect(stripHtmlTags('<div><span>text</span></div>')).toContain('text');
  });

  it('handles self-closing tags', () => {
    expect(stripHtmlTags('line1<br/>line2')).toContain('line1');
    expect(stripHtmlTags('line1<br/>line2')).toContain('line2');
  });
});

describe('estimateTokens — additional cases', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 1 for very short strings', () => {
    expect(estimateTokens('hi')).toBe(1);
  });

  it('estimates roughly 4 chars per token', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});

describe('buildFrontMatter — additional cases', () => {
  it('handles values with special characters', () => {
    const result = buildFrontMatter({ title: 'Test: Value' });
    expect(result).toContain('"Test: Value"');
  });

  it('handles empty metadata object', () => {
    const result = buildFrontMatter({});
    expect(result).toContain('---');
  });
});

describe('aggregateResults — additional cases', () => {
  it('preserves order for non-overlapping results', () => {
    const results = aggregateResults([
      { provider: 'brave', results: [{ title: 'A', url: 'https://a.com', snippet: 'a' }] },
      { provider: 'bing', results: [{ title: 'B', url: 'https://b.com', snippet: 'b' }] },
    ]);
    expect(results).toHaveLength(2);
  });

  it('merges sources for duplicate URLs', () => {
    const results = aggregateResults([
      { provider: 'brave', results: [{ title: 'Same', url: 'https://same.com', snippet: 'x' }] },
      { provider: 'bing', results: [{ title: 'Same', url: 'https://same.com', snippet: 'y' }] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('ranks cross-referenced results first', () => {
    const results = aggregateResults([
      {
        provider: 'brave',
        results: [
          { title: 'Unique', url: 'https://unique.com', snippet: 'u' },
          { title: 'Shared', url: 'https://shared.com', snippet: 's1' },
        ],
      },
      {
        provider: 'bing',
        results: [{ title: 'Shared', url: 'https://shared.com', snippet: 's2' }],
      },
    ]);
    expect(results[0]!.url).toBe('https://shared.com');
  });
});

describe('getAvailableProviders — additional cases', () => {
  it('returns only duckduckgo when no API keys set', () => {
    const providers = getAvailableProviders(makeConfig());
    expect(providers).toContain('duckduckgo');
    expect(providers).not.toContain('brave');
    expect(providers).not.toContain('bing');
  });

  it('includes multiple providers when keys set', () => {
    const providers = getAvailableProviders(
      makeConfig({
        braveSearchApiKey: 'key',
        bingSearchApiKey: 'key',
        exaApiKey: 'key',
      })
    );
    expect(providers).toContain('duckduckgo');
    expect(providers).toContain('brave');
    expect(providers).toContain('bing');
    expect(providers).toContain('exa');
  });
});
