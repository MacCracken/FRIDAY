/**
 * Chat Routes — Conversation with any personality via the dashboard.
 *
 * Accepts an optional `personalityId` to target a specific personality;
 * falls back to the active personality when omitted.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SecureYeoman } from '../secureyeoman.js';
import type {
  AIRequest,
  Tool,
  FallbackModelConfig,
  AIProviderName,
  ChatStreamEvent,
  McpToolDef,
  McpFeatures,
  SourceReference,
  CitationMeta,
} from '@secureyeoman/shared';
import type { McpFeatureConfig } from '../mcp/storage.js';
import { PreferenceLearner, type FeedbackType } from '../brain/preference-learner.js';
import { sendError, toErrorMessage } from '../utils/errors.js';
import { ToolOutputScanner } from '../security/tool-output-scanner.js';
import { PromptGuard } from '../security/prompt-guard.js';
import { createResponseGuard } from '../security/response-guard.js';
import { AbuseDetector } from '../security/abuse-detector.js';
import { createContentGuardrail } from '../security/content-guardrail.js';
import { GuardrailPipeline } from '../security/guardrail-pipeline.js';
import {
  ToolOutputScannerFilter,
  ResponseGuardFilter,
  ContentGuardrailFilter,
} from '../security/guardrail-builtin-filters.js';
import { loadCustomFilters } from '../security/guardrail-filter-loader.js';
import { registerGuardrailPipelineRoutes } from '../security/guardrail-pipeline-routes.js';
import { LLMJudge } from '../security/llm-judge.js';
import { ConstitutionalEngine } from '../security/constitutional.js';
import { ContextCompactor, getContextWindowSize } from './context-compactor.js';
import { GroundingChecker } from '../brain/grounding-checker.js';
import { getLogger } from '../logging/logger.js';
import { executeCreationTool } from '../soul/creation-tool-executor.js';

// Map provider name → standard API key env var (no-key providers get empty string)
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_GENERATIVE_AI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  grok: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  agnos: 'AGNOS_GATEWAY_API_KEY',
};

function resolvePersonalityFallbacks(
  fallbacks: { provider: string; model: string }[]
): FallbackModelConfig[] {
  return fallbacks.map((f) => ({
    provider: f.provider as AIProviderName,
    model: f.model,
    apiKeyEnv: PROVIDER_KEY_ENV[f.provider] ?? '',
  }));
}

export interface ChatRoutesOptions {
  secureYeoman: SecureYeoman;
}

// ─── Module-level constants shared by both chat handlers ────────────────────

/**
 * Cheap fast-tier model used for context compaction summarisation.
 * Avoids paying premium-model prices for a simple summarisation side-call.
 */
const COMPACTION_MODEL = 'claude-haiku-3-5-20241022';

/** Max character length for tool descriptions sent in schemas. */
const TOOL_DESCRIPTION_MAX_CHARS = 200;

/**
 * Max character length for tool result content appended to the message array.
 * Prevents a single oversized tool output (e.g. web scrape, large file read)
 * from consuming the entire context window in the agentic tool loop.
 */
const TOOL_RESULT_MAX_CHARS = 16_000;

/**
 * Max character length for old assistant messages in conversation history.
 * Newer messages (last 4) are kept in full; older ones are trimmed to save
 * tokens on every turn of long conversations.
 */
const HISTORY_MSG_MAX_CHARS = 2_000;

/** Number of recent history entries to keep untrimmed. */
const HISTORY_RECENT_FULL = 4;

/** Truncate a tool result string, appending an indicator if trimmed. */
function truncateToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  return content.slice(0, TOOL_RESULT_MAX_CHARS) + '\n…[truncated — output exceeded 16 000 chars]';
}

const CREATION_TOOL_LABELS: Record<string, string> = {
  create_skill: 'Skill',
  update_skill: 'Skill',
  delete_skill: 'Skill',
  create_task: 'Task',
  update_task: 'Task',
  create_personality: 'Personality',
  update_personality: 'Personality',
  delete_personality: 'Personality',
  create_experiment: 'Experiment',
  delete_experiment: 'Experiment',
  create_swarm: 'Swarm',
  create_custom_role: 'Custom Role',
  delete_custom_role: 'Custom Role',
  assign_role: 'Role Assignment',
  revoke_role: 'Role Assignment',
  a2a_connect: 'A2A Connection',
  delegate_task: 'Delegation',
  create_workflow: 'Workflow',
  update_workflow: 'Workflow',
  delete_workflow: 'Workflow',
  trigger_workflow: 'Workflow Run',
};

function toolAction(toolName: string): string {
  if (toolName.startsWith('create_')) return 'Created';
  if (toolName.startsWith('update_')) return 'Updated';
  if (toolName.startsWith('delete_')) return 'Deleted';
  if (toolName.startsWith('trigger_')) return 'Triggered';
  if (toolName.startsWith('assign_')) return 'Assigned';
  if (toolName.startsWith('revoke_')) return 'Revoked';
  if (toolName === 'a2a_connect') return 'Connected';
  if (toolName === 'delegate_task') return 'Delegated';
  return 'Created';
}

// Prefix lists compiled once at module load — used inside filterMcpTools.
const NETWORK_DEVICE_PREFIXES = [
  'network_device_',
  'network_show_',
  'network_config_',
  'network_health_',
  'network_ping_',
  'network_traceroute',
];
const NETWORK_DISCOVERY_PREFIXES = [
  'network_discovery_',
  'network_topology_',
  'network_arp_',
  'network_mac_',
  'network_routing_',
  'network_ospf_',
  'network_bgp_',
  'network_interface_',
  'network_vlan_',
];
const NETWORK_AUDIT_PREFIXES = [
  'network_acl_',
  'network_aaa_',
  'network_port_',
  'network_stp_',
  'network_software_',
];
const NETWORK_UTIL_PREFIXES = ['subnet_', 'wildcard_', 'pcap_'];

// ── CLI github_* tool prefixes (gated by exposeGit, NOT exposeGithub) ──────────
// These are the legacy gh-binary tools registered by git-tools.ts.
// The Phase-70 REST API tools (github_profile, github_list_repos, …) start with
// different prefixes and are gated separately by exposeGithub.
const GITHUB_CLI_PREFIXES = ['github_pr_', 'github_issue_', 'github_repo_'];

/**
 * Return true if a YEOMAN MCP tool name is a CLI git/github tool that requires
 * the `exposeGit` flag, rather than the Phase-70 REST API tools (exposeGithub).
 */
function isGitCliTool(name: string): boolean {
  return name.startsWith('git_') || GITHUB_CLI_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Keywords that imply the user is likely to need tools from a given group.
 * Used by selectMcpToolSchemas() to decide which full JSON schemas to include.
 * Matching is case-insensitive substring search against the current message.
 *
 * Phase 72 — MCP Tool Context Optimization.
 */
const TOOL_GROUP_KEYWORDS: Record<string, string[]> = {
  git: [
    'git',
    'commit',
    'branch',
    'merge',
    'diff',
    'checkout',
    'stash',
    'pull request',
    'rebase',
    'blame',
    'log',
  ],
  github_api: [
    'github',
    'repo',
    'repository',
    'fork',
    'ssh key',
    'issue',
    'pr',
    'pull request',
    'push',
    'clone',
  ],
  fs: [
    'file',
    'directory',
    'folder',
    'path',
    'read file',
    'write file',
    'delete file',
    'list files',
    'mkdir',
  ],
  web_scrape: ['scrape', 'crawl', 'fetch url', 'fetch page', 'extract', 'parse html', 'web page'],
  web_search: ['search', 'google', 'look up', 'find online', 'search the web', 'web search'],
  browser: ['browser', 'chrome', 'screenshot', 'click', 'navigate', 'selenium', 'playwright'],
  gmail: ['email', 'gmail', 'inbox', 'compose', 'send email', 'message', 'mail', 'attachment'],
  twitter: ['twitter', 'tweet', 'post', 'mention', 'timeline', 'retweet', 'like', 'social media'],
  github_connected: [
    'github',
    'repo',
    'repository',
    'fork',
    'ssh',
    'issue',
    'pull request',
    'push',
    'clone',
    'star',
  ],
  network: [
    'network',
    'device',
    'topology',
    'ping',
    'traceroute',
    'vlan',
    'bgp',
    'ospf',
    'arp',
    'interface',
    'firewall',
    'acl',
  ],
  twingate: ['twingate', 'vpn', 'zero trust', 'network access', 'remote access'],
  security: [
    'scan',
    'nmap',
    'sqlmap',
    'nuclei',
    'gobuster',
    'hydra',
    'vulnerability',
    'pentest',
    'bruteforce',
    'security audit',
  ],
  ollama: ['ollama', 'model', 'pull model', 'delete model', 'local model', 'llm'],
};

/**
 * Group name → check function. Returns true if this group's tools should be included
 * based on message keywords or recent conversation history tool calls.
 *
 * "Core" tools (brain, task, sys, soul, audit, intent, skill, mem) always pass —
 * they are short and almost always needed.
 */
function isGroupRelevant(
  groupName: string,
  message: string,
  historyToolNames: Set<string>
): boolean {
  const keywords = TOOL_GROUP_KEYWORDS[groupName];
  if (!keywords) return true; // unknown group → always include

  const lc = message.toLowerCase();
  if (keywords.some((kw) => lc.includes(kw))) return true;
  // If the AI already called a tool from this group in history, keep the schemas hot
  return historyToolNames.has(groupName);
}

/**
 * Derive the tool-group name for a YEOMAN MCP tool based on its prefix.
 * Returns null for "core" tools that always get full schemas.
 */
function toolGroupName(name: string): string | null {
  if (isGitCliTool(name)) return 'git';
  if (name.startsWith('github_') && !isGitCliTool(name)) return 'github_api';
  if (name.startsWith('fs_')) return 'fs';
  if (
    name.startsWith('web_scrape') ||
    name === 'web_extract_structured' ||
    name === 'web_fetch_markdown'
  )
    return 'web_scrape';
  if (name.startsWith('web_search')) return 'web_search';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('gmail_')) return 'gmail';
  if (name.startsWith('twitter_')) return 'twitter';
  if (
    NETWORK_DEVICE_PREFIXES.some((p) => name.startsWith(p)) ||
    NETWORK_DISCOVERY_PREFIXES.some((p) => name.startsWith(p)) ||
    NETWORK_AUDIT_PREFIXES.some((p) => name.startsWith(p)) ||
    name.startsWith('netbox_') ||
    name.startsWith('nvd_') ||
    NETWORK_UTIL_PREFIXES.some((p) => name.startsWith(p))
  )
    return 'network';
  if (name.startsWith('twingate_')) return 'twingate';
  if (
    name.startsWith('sec_') ||
    name.startsWith('nmap_') ||
    name.startsWith('sqlmap_') ||
    name.startsWith('nuclei_') ||
    name.startsWith('gobuster_') ||
    name.startsWith('hydra_')
  )
    return 'security';
  if (name.startsWith('ollama_')) return 'ollama';
  // Brain, task, sys, soul, audit, intent, skill, mem → core, always send
  return null;
}

/**
 * Build a compact MCP tool catalog block for the system prompt.
 * Lists enabled tool names + one-line descriptions grouped by feature area.
 * This tells the AI what tools exist without sending full JSON schemas.
 *
 * Phase 72 — catalog mode.
 */
export function buildMcpToolCatalog(tools: Tool[]): string {
  if (tools.length === 0) return '';

  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const group = toolGroupName(tool.name) ?? 'core';
    if (!groups[group]) groups[group] = [];
    const desc = tool.description ? `: ${tool.description.split('.')[0]}` : '';
    groups[group].push(`\`${tool.name}\`${desc}`);
  }

  const GROUP_LABELS: Record<string, string> = {
    core: 'Core (Brain, Tasks, System, Soul)',
    git: 'Git / GitHub CLI',
    github_api: 'GitHub API (OAuth)',
    fs: 'Filesystem',
    web_scrape: 'Web Scraping',
    web_search: 'Web Search',
    browser: 'Browser Automation',
    gmail: 'Gmail',
    twitter: 'Twitter',
    network: 'Network Tools',
    twingate: 'Twingate',
    security: 'Security Toolkit',
    ollama: 'Ollama Model Management',
  };

  const lines: string[] = [
    '## Available MCP Tools',
    'Full tool schemas are loaded on-demand based on conversation context. All listed tools are available to call.',
  ];
  for (const [group, entries] of Object.entries(groups)) {
    const label = GROUP_LABELS[group] ?? group;
    lines.push(`\n**${label}** (${entries.length}): ${entries.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Filter all available MCP tools down to those the current personality is
 * permitted to access. Applied identically to both the streaming and
 * non-streaming chat handlers so gating logic stays consistent.
 *
 * Phase 72: `github_*` CLI tools (github_pr_*, github_issue_*, github_repo_*)
 * are gated by exposeGit. Phase-70 REST API tools (github_profile, github_list_repos, …)
 * are gated by exposeGithub — previously they were incorrectly bundled with exposeGit.
 */
export function filterMcpTools(
  allMcpTools: McpToolDef[],
  selectedServers: string[],
  globalConfig: McpFeatureConfig,
  perPersonality: Partial<McpFeatures>
): Tool[] {
  const globalNetworkOk = globalConfig.exposeNetworkTools;
  const globalTwingateOk = globalConfig.exposeTwingateTools;
  const tools: Tool[] = [];

  // Data-driven feature gate rules for YEOMAN MCP tools.
  // Each rule: [match predicate, isAllowed(global, personality) → boolean]
  // Default logic: requires BOTH global AND personality flags. Override for special cases.
  type GateRule = [
    (n: string) => boolean,
    (g: McpFeatureConfig, p: Partial<McpFeatures>) => boolean,
  ];
  const gateRules: GateRule[] = [
    [isGitCliTool, (g, p) => !!(g.exposeGit && p.exposeGit)],
    [
      (n) => n.startsWith('github_') && !isGitCliTool(n),
      (g, p) => !!(g.exposeGithub && p.exposeGithub),
    ],
    [(n) => n.startsWith('fs_'), (g, p) => !!(g.exposeFilesystem && p.exposeFilesystem)],
    // Web scraping: allowed if (global scraping OR global web) OR personality scraping (OR logic from original)
    [
      (n) =>
        n.startsWith('web_scrape') || n === 'web_extract_structured' || n === 'web_fetch_markdown',
      (g, p) => !!((g.exposeWebScraping ?? g.exposeWeb) || p.exposeWebScraping),
    ],
    [(n) => n.startsWith('web_search'), (g, p) => !!(g.exposeWeb && p.exposeWebSearch)],
    [(n) => n.startsWith('browser_'), (g, p) => !!(g.exposeBrowser && p.exposeBrowser)],
    [
      (n) => NETWORK_DEVICE_PREFIXES.some((px) => n.startsWith(px)),
      (_g, p) => !!(globalNetworkOk && p.exposeNetworkDevices),
    ],
    [
      (n) => NETWORK_DISCOVERY_PREFIXES.some((px) => n.startsWith(px)),
      (_g, p) => !!(globalNetworkOk && p.exposeNetworkDiscovery),
    ],
    [
      (n) => NETWORK_AUDIT_PREFIXES.some((px) => n.startsWith(px)),
      (_g, p) => !!(globalNetworkOk && p.exposeNetworkAudit),
    ],
    [(n) => n.startsWith('netbox_'), (_g, p) => !!(globalNetworkOk && p.exposeNetBox)],
    [(n) => n.startsWith('nvd_'), (_g, p) => !!(globalNetworkOk && p.exposeNvd)],
    [
      (n) => NETWORK_UTIL_PREFIXES.some((px) => n.startsWith(px)),
      (_g, p) => !!(globalNetworkOk && p.exposeNetworkUtils),
    ],
    [(n) => n.startsWith('twingate_'), (_g, p) => !!(globalTwingateOk && p.exposeTwingate)],
    [(n) => n.startsWith('gmail_'), (g, p) => !!(g.exposeGmail && p.exposeGmail)],
    [(n) => n.startsWith('twitter_'), (g, p) => !!(g.exposeTwitter && p.exposeTwitter)],
    [(n) => n.startsWith('terminal_'), (g, p) => !!(g.exposeTerminal && p.exposeTerminal)],
  ];

  for (const tool of allMcpTools) {
    if (tool.serverName === 'YEOMAN MCP') {
      const n = tool.name;

      let gated = false;
      for (const [match, isAllowed] of gateRules) {
        if (match(n) && !isAllowed(globalConfig, perPersonality)) {
          gated = true;
          break;
        }
      }
      if (gated) continue;
    } else {
      if (!selectedServers.includes(tool.serverName)) continue;
    }

    const raw = tool.inputSchema ?? {};
    const parameters: Tool['parameters'] = raw.type
      ? (raw as Tool['parameters'])
      : { type: 'object', properties: {}, ...(raw as object) };
    // Truncate verbose tool descriptions to save tokens per request
    let desc = tool.description || undefined;
    if (desc && desc.length > TOOL_DESCRIPTION_MAX_CHARS) {
      desc = desc.slice(0, TOOL_DESCRIPTION_MAX_CHARS - 1) + '…';
    }
    tools.push({ name: tool.name, description: desc, parameters });
  }

  return tools;
}

/**
 * Phase 72 — Two-pass MCP tool schema selector.
 *
 * Pass 1: Feature-flag filter (existing filterMcpTools logic).
 *         Returns all tools the personality is allowed to access.
 *
 * Pass 2: Relevance filter.
 *         If alwaysSendFullSchemas is true → return all of Pass 1.
 *         Otherwise → return only tools whose group is relevant to the
 *         current message or has been used in the recent conversation history.
 *         "Core" tools (brain, task, sys, etc.) always pass.
 *
 * Also returns the full Pass-1 list for catalog generation.
 */
export function selectMcpToolSchemas(
  allMcpTools: McpToolDef[],
  selectedServers: string[],
  globalConfig: McpFeatureConfig,
  perPersonality: Partial<McpFeatures>,
  currentMessage: string,
  history: { role: string; content: string }[]
): { schemasToSend: Tool[]; allAllowed: Tool[] } {
  // Pass 1: feature-flag filter
  const allAllowed = filterMcpTools(allMcpTools, selectedServers, globalConfig, perPersonality);

  if (globalConfig.alwaysSendFullSchemas) {
    return { schemasToSend: allAllowed, allAllowed };
  }

  // Build set of tool groups used in recent history (last 20 messages)
  const recentHistory = history.slice(-20);
  const historyToolNames = new Set<string>();
  for (const msg of recentHistory) {
    if (msg.role !== 'assistant') continue;
    // Tool calls appear in assistant messages as JSON tool_use blocks or plain text references.
    // A simple heuristic: scan for known group keywords in the content.
    const lc = msg.content.toLowerCase();
    for (const [group, keywords] of Object.entries(TOOL_GROUP_KEYWORDS)) {
      if (keywords.some((kw) => lc.includes(kw))) historyToolNames.add(group);
    }
  }

  // Pass 2: relevance filter
  const schemasToSend = allAllowed.filter((tool) => {
    // External server tools (custom MCP servers) always get full schemas
    const isYeomanTool = allMcpTools.find((t) => t.name === tool.name)?.serverName === 'YEOMAN MCP';
    if (!isYeomanTool) return true;

    const group = toolGroupName(tool.name);
    if (group === null) return true; // core tool — always send
    return isGroupRelevant(group, currentMessage, historyToolNames);
  });

  return { schemasToSend, allAllowed };
}

// ── Citation Instruction Builder (Phase 110) ─────────────────────────────────

/**
 * Build a system prompt instruction block telling the LLM to produce
 * inline [N] citations referencing the provided sources.
 */
function buildCitationInstruction(sources: SourceReference[]): string {
  const sourceList = sources
    .map(
      (s) =>
        `[${s.index}] ${s.sourceLabel}${s.documentTitle ? ` (${s.documentTitle})` : ''}${s.url ? ` — ${s.url}` : ''}`
    )
    .join('\n');
  return `

## Citation Instructions

You have access to the following sources. When your response uses information from a source, cite it inline using the notation [N] where N is the source number. Place the citation immediately after the relevant claim or sentence. You may cite multiple sources for a single claim, e.g. [1][3]. Do NOT invent citation numbers beyond those listed below.

### Available Sources
${sourceList}

If you cannot find supporting evidence in the sources for a claim, state the claim without a citation.`;
}

/**
 * Parse web search tool results and append them as web_search sources
 * to the brain context for citation.
 */
function captureWebSearchSources(output: unknown, brainContext: BrainContextMeta): void {
  try {
    if (!brainContext.sources) brainContext.sources = [];
    const nextIndex = () =>
      brainContext.sources!.length > 0
        ? Math.max(...brainContext.sources!.map((s) => s.index)) + 1
        : 1;

    const out = output as Record<string, unknown>;

    // Handle array of results (web_search_batch or web_search returning array)
    const results = Array.isArray(out.results) ? out.results : Array.isArray(out) ? out : [];

    for (const item of results) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      const title = String(r.title ?? r.name ?? 'Web result');
      const snippet = String(r.snippet ?? r.content ?? r.description ?? '');
      const url =
        typeof r.url === 'string' ? r.url : typeof r.link === 'string' ? r.link : undefined;

      if (!snippet) continue;

      brainContext.sources.push({
        index: nextIndex(),
        type: 'web_search',
        sourceId: url ?? `web-${Date.now()}-${randomBytes(4).toString('hex')}`,
        content: snippet,
        sourceLabel: title,
        url,
      });
    }
  } catch {
    // Best-effort — don't break the chat flow
  }
}

interface ChatRequestBody {
  message: string;
  history?: { role: string; content: string }[];
  personalityId?: string;
  strategyId?: string;
  saveAsMemory?: boolean;
  memoryEnabled?: boolean;
  conversationId?: string;
  clientContext?: { viewportHint?: 'mobile' | 'tablet' | 'desktop' };
}

interface RememberRequestBody {
  content: string;
  context?: Record<string, string>;
}

interface FeedbackRequestBody {
  conversationId: string;
  messageId: string;
  feedback: FeedbackType;
  details?: string;
}

interface BrainContextMeta {
  memoriesUsed: number;
  knowledgeUsed: number;
  contextSnippets: string[];
  /** Set when notebook or hybrid mode is active and the corpus was loaded. */
  notebookBlock?: string;
  /** Knowledge mode that was active for this request. */
  knowledgeMode?: 'rag' | 'notebook' | 'hybrid';
  /** Structured source references for inline citations (Phase 110). */
  sources?: SourceReference[];
}

// ── Brain context helpers (shared by streaming and non-streaming paths) ───────

/**
 * Token budget for notebook mode: 65% of the model's context window.
 * Leaves ~35% for system prompt, tools, and conversation history.
 */
function notebookBudget(model: string, override?: number): number {
  if (override && override > 0) return override;
  return Math.floor(getContextWindowSize(model) * 0.65);
}

/**
 * Build the [NOTEBOOK — SOURCE LIBRARY] block injected into the system prompt.
 */
function buildNotebookBlock(
  docs: { title: string; format: string | null; chunkCount: number; text: string }[]
): string {
  const lines: string[] = [
    '[NOTEBOOK — SOURCE LIBRARY]',
    'The following source documents are your primary knowledge base.',
    'Prioritize information from these sources over your general training.',
    'When answering, cite the source document by title.',
    'If a question cannot be answered from the sources, clearly state this.',
    `Document count: ${docs.length} | Source-grounded mode active`,
    '',
  ];
  for (const doc of docs) {
    const fmt = doc.format ? ` (${doc.format}, ${doc.chunkCount} chunks)` : '';
    lines.push(`=== "${doc.title}"${fmt} ===`);
    lines.push(doc.text);
    lines.push('');
  }
  lines.push('[END SOURCE LIBRARY]');
  return lines.join('\n');
}

async function gatherBrainContext(
  secureYeoman: SecureYeoman,
  message: string,
  personalityId?: string,
  knowledgeMode: 'rag' | 'notebook' | 'hybrid' = 'rag',
  model = '',
  notebookTokenBudgetOverride?: number
): Promise<BrainContextMeta> {
  try {
    const brainManager = secureYeoman.getBrainManager();

    // ── Notebook / Hybrid paths ──────────────────────────────────────────
    if (knowledgeMode === 'notebook' || knowledgeMode === 'hybrid') {
      let docManager;
      try {
        docManager = secureYeoman.getDocumentManager();
      } catch {
        // Document manager unavailable — fall through to RAG
      }

      if (docManager) {
        const budget = notebookBudget(model, notebookTokenBudgetOverride);
        const corpus = await docManager.getNotebookCorpus(personalityId ?? null, budget);

        const canUseNotebook = corpus.documents.length > 0 && corpus.fitsInBudget;

        if (canUseNotebook) {
          // Also fetch memories (still useful even in notebook mode)
          const memories = await brainManager.recall({
            search: message,
            limit: 5,
            ...(personalityId ? { personalityId } : {}),
          });
          const snippets: string[] = [];
          for (const m of memories) snippets.push(`[${m.type}] ${m.content}`);

          const notebookBlock = buildNotebookBlock(corpus.documents);
          return {
            memoriesUsed: memories.length,
            knowledgeUsed: corpus.documents.length,
            contextSnippets: snippets,
            notebookBlock,
            knowledgeMode,
          };
        }

        // hybrid: corpus didn't fit → fall through to RAG
        // notebook: corpus empty or oversized → fall through to RAG with warning
        if (knowledgeMode === 'notebook' && corpus.documents.length > 0 && !corpus.fitsInBudget) {
          // Load as many docs as fit, sorted by creation order (smallest first via chunkCount)
          const sorted = [...corpus.documents].sort(
            (a, b) => a.estimatedTokens - b.estimatedTokens
          );
          const selected: typeof sorted = [];
          let used = 0;
          for (const doc of sorted) {
            if (used + doc.estimatedTokens <= budget) {
              selected.push(doc);
              used += doc.estimatedTokens;
            }
          }
          if (selected.length > 0) {
            const memories = await brainManager.recall({
              search: message,
              limit: 5,
              ...(personalityId ? { personalityId } : {}),
            });
            const snippets: string[] = [];
            for (const m of memories) snippets.push(`[${m.type}] ${m.content}`);
            const notebookBlock =
              buildNotebookBlock(selected) +
              `\n\n⚠ ${corpus.documents.length - selected.length} document(s) omitted — corpus exceeds ${budget.toLocaleString()} token budget. Switch to hybrid mode to auto-fall-back to RAG.`;
            return {
              memoriesUsed: memories.length,
              knowledgeUsed: selected.length,
              contextSnippets: snippets,
              notebookBlock,
              knowledgeMode,
            };
          }
        }
      }
    }

    // ── RAG path (default + hybrid fallback) ────────────────────────────
    const [memories, knowledge] = await Promise.all([
      brainManager.recall({
        search: message,
        limit: 5,
        ...(personalityId ? { personalityId } : {}),
      }),
      brainManager.queryKnowledge({
        search: message,
        limit: 5,
        ...(personalityId ? { personalityId } : {}),
      }),
    ]);
    const snippets: string[] = [];
    for (const m of memories) snippets.push(`[${m.type}] ${m.content}`);
    for (const k of knowledge) snippets.push(`[${k.topic}] ${k.content}`);

    // Build structured source references for citations (Phase 110)
    const sources: SourceReference[] = [];
    let srcIdx = 1;
    for (const m of memories) {
      sources.push({
        index: srcIdx++,
        type: 'memory',
        sourceId: m.id,
        content: m.content,
        sourceLabel: `[${m.type}] Memory`,
        confidence: m.importance,
      });
    }
    // Batch-resolve document metadata for knowledge chunks
    const docIdSet = new Set<string>();
    for (const k of knowledge) {
      const match = /^document:([^:]+):chunk/.exec(k.source);
      if (match) docIdSet.add(match[1]!);
    }
    const docMap = new Map<string, { title: string; trustScore: number }>();
    if (docIdSet.size > 0) {
      try {
        const docMgr = secureYeoman.getDocumentManager();
        const docs = await docMgr.listDocuments();
        for (const d of docs) {
          if (docIdSet.has(d.id)) {
            docMap.set(d.id, { title: d.title, trustScore: d.trustScore });
          }
        }
      } catch {
        /* best-effort */
      }
    }
    for (const k of knowledge) {
      const chunkMatch = /^document:([^:]+):chunk(\d+)$/.exec(k.source);
      const ref: SourceReference = {
        index: srcIdx++,
        type: chunkMatch ? 'document_chunk' : 'knowledge',
        sourceId: k.id,
        content: k.content,
        sourceLabel: k.topic,
        confidence: k.confidence,
      };
      if (chunkMatch) {
        const docId = chunkMatch[1]!;
        ref.documentId = docId;
        const docMeta = docMap.get(docId);
        if (docMeta) {
          ref.documentTitle = docMeta.title;
          ref.trustScore = docMeta.trustScore;
        }
      }
      sources.push(ref);
    }

    return {
      memoriesUsed: memories.length,
      knowledgeUsed: knowledge.length,
      contextSnippets: snippets,
      knowledgeMode: knowledgeMode === 'rag' ? 'rag' : knowledgeMode,
      sources: sources.length > 0 ? sources : undefined,
    };
  } catch {
    return { memoriesUsed: 0, knowledgeUsed: 0, contextSnippets: [] };
  }
}

async function applyPreferenceInjection(
  secureYeoman: SecureYeoman,
  prompt: string
): Promise<string> {
  try {
    const brainManager = secureYeoman.getBrainManager();
    const learner = new PreferenceLearner(brainManager);
    return await learner.injectPreferences(prompt);
  } catch {
    return prompt;
  }
}

export function registerChatRoutes(app: FastifyInstance, opts: ChatRoutesOptions): void {
  const { secureYeoman } = opts;

  // Scanner is instantiated once per route registration; logger is best-effort.
  let scanner: ToolOutputScanner;
  try {
    scanner = new ToolOutputScanner({ logger: getLogger().child({ component: 'chat-routes' }) });
  } catch {
    scanner = new ToolOutputScanner();
  }

  // Prompt-assembly injection guard — scans fully assembled messages before LLM call.
  const promptGuard = new PromptGuard(secureYeoman.getConfig().security.promptGuard);

  // Response-side safety scanner (Phase 54).
  const responseGuard = createResponseGuard(secureYeoman.getConfig().security.responseGuard);

  // Rate-aware abuse detector — tracks blocked retries, topic pivots, tool anomalies (Phase 77).
  const abuseDetector = new AbuseDetector(
    secureYeoman.getConfig().security.abuseDetection,
    (params) =>
      void secureYeoman.getAuditChain().record({
        event: params.event,
        level: params.level,
        message: params.message,
        metadata: params.metadata,
      })
  );

  // Output-side content policy enforcement: PII, topic restrictions, toxicity, block lists, grounding (Phase 95).
  const contentGuardrail = createContentGuardrail(
    secureYeoman.getConfig().security.contentGuardrails,
    {
      brainManager: (() => {
        try {
          return secureYeoman.getBrainManager?.() ?? null;
        } catch {
          return null;
        }
      })(),
      auditRecord: (p) =>
        void secureYeoman.getAuditChain().record({
          event: p.event,
          level: p.level as 'info' | 'warn' | 'error',
          message: p.message,
          metadata: p.metadata,
        }),
    }
  );

  // Groundedness enforcement — verifies AI claims against retrieved sources (Phase 110).
  const groundingChecker = new GroundingChecker();

  // Constitutional AI — self-critique and revision loop.
  let constitutionalEngine: ConstitutionalEngine | null = null;
  try {
    const constitutionalConfig = secureYeoman.getConfig().security.constitutional;
    if (constitutionalConfig.enabled) {
      const _aiClientForConst = secureYeoman.getAIClient();
      constitutionalEngine = new ConstitutionalEngine(constitutionalConfig, {
        logger: secureYeoman.getLogger(),
        chat: async (msgs, opts) => {
          const resp = await _aiClientForConst.chat({
            messages: msgs.map((m) => ({ role: m.role, content: m.content })),
            model: opts?.model,
            temperature: opts?.temperature,
            stream: false,
          });
          return resp.content;
        },
        getIntentBoundaries: () => {
          const intentMgr = secureYeoman.getIntentManager?.();
          if (!intentMgr) return [];
          const doc = intentMgr.getActiveIntent?.();
          return doc?.hardBoundaries ?? [];
        },
      });
    }
  } catch {
    constitutionalEngine = null;
  }

  // LLM-as-Judge for high-autonomy tool calls (Phase 54).
  let llmJudge: LLMJudge | null = null;
  try {
    llmJudge = new LLMJudge(secureYeoman.getConfig().security.llmJudge, {
      aiClient: secureYeoman.getAIClient(),
      intentManager: secureYeoman.getIntentManager?.() ?? null,
    });
  } catch {
    // AI client not available yet — LLMJudge is disabled
    llmJudge = null;
  }

  // ── Guardrail Pipeline (Phase 143) — extensible filter chain ──────────────
  const pipelineConfig = secureYeoman.getConfig().security.guardrailPipeline ?? {
    enabled: false,
    autoLoadCustomFilters: false,
    customFilterDir: '',
    filters: [],
  };
  const guardrailPipeline = new GuardrailPipeline(pipelineConfig, {
    auditRecord: (p) =>
      void secureYeoman.getAuditChain().record({
        event: p.event,
        level: p.level as 'info' | 'warn' | 'error',
        message: p.message,
        metadata: p.metadata,
      }),
    logger: (() => {
      try {
        return getLogger().child({ component: 'guardrail-pipeline' });
      } catch {
        return undefined;
      }
    })(),
  });

  // Register builtin filters as pipeline adapters
  const toolOutputScannerFilter = new ToolOutputScannerFilter(scanner);
  const responseGuardFilter = new ResponseGuardFilter(responseGuard);
  const contentGuardrailFilter = new ContentGuardrailFilter(contentGuardrail);
  guardrailPipeline.registerFilter(toolOutputScannerFilter);
  guardrailPipeline.registerFilter(responseGuardFilter);
  guardrailPipeline.registerFilter(contentGuardrailFilter);

  // Load custom filters from disk (async, non-blocking)
  if (pipelineConfig.autoLoadCustomFilters) {
    void loadCustomFilters({
      filterDir: pipelineConfig.customFilterDir,
      logger: (() => {
        try {
          return getLogger().child({ component: 'guardrail-filter-loader' });
        } catch {
          return undefined;
        }
      })(),
    }).then((customFilters) => {
      for (const f of customFilters) {
        guardrailPipeline.registerFilter(f);
      }
    });
  }

  // Register guardrail pipeline admin routes (Phase 143)
  registerGuardrailPipelineRoutes(app, { pipeline: guardrailPipeline });

  // Context compactor — triggers at 80% of the model's context window.
  const compactor = new ContextCompactor();

  app.post(
    '/api/v1/chat',
    async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const {
        message,
        history,
        personalityId,
        strategyId,
        saveAsMemory,
        memoryEnabled = true,
        conversationId,
        clientContext,
      } = request.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return sendError(reply, 400, 'Message is required');
      }

      // Input validation — check message and history for injection patterns
      const validator = secureYeoman.getValidator();
      const msgValidation = validator.validate(message, { source: 'chat' });
      // Abuse detection session key
      const _abUserId = request.authUser?.userId ?? request.ip ?? 'anonymous';
      const _abSessionId = `${_abUserId}:${conversationId ?? 'noconv'}`;

      if (msgValidation.blocked) {
        void secureYeoman.getAuditChain().record({
          event: 'injection_attempt',
          level: 'warn',
          message: 'Chat message blocked by input validator',
          userId: (request as FastifyRequest & { user?: { id?: string } }).user?.id,
          metadata: { endpoint: '/api/v1/chat', reason: msgValidation.blockReason },
        });
        abuseDetector.recordBlock(_abSessionId);
        return sendError(reply, 400, 'Message blocked: invalid content');
      }

      // Abuse detection: cool-down check + topic pivot recording (Phase 77)
      {
        const abCheck = abuseDetector.check(_abSessionId);
        if (abCheck.inCoolDown) {
          return sendError(
            reply,
            429,
            `Temporarily rate limited due to suspicious activity. Retry after ${abCheck.coolDownUntil}`
          );
        }
        abuseDetector.recordMessage(_abSessionId, message);
      }

      if (history && Array.isArray(history)) {
        for (const entry of history) {
          if (typeof entry.content === 'string') {
            const hv = validator.validate(entry.content, { source: 'chat_history' });
            if (hv.blocked) {
              void secureYeoman.getAuditChain().record({
                event: 'injection_attempt',
                level: 'warn',
                message: 'Chat history entry blocked by input validator',
                userId: (request as FastifyRequest & { user?: { id?: string } }).user?.id,
                metadata: { endpoint: '/api/v1/chat', reason: hv.blockReason },
              });
              return sendError(reply, 400, 'Message blocked: invalid content in history');
            }
          }
        }
      }

      // Validate viewportHint if present
      const VALID_VIEWPORTS = ['mobile', 'tablet', 'desktop'] as const;
      const viewportHint =
        clientContext?.viewportHint &&
        (VALID_VIEWPORTS as readonly string[]).includes(clientContext.viewportHint)
          ? clientContext.viewportHint
          : undefined;

      let aiClient;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        return sendError(
          reply,
          503,
          'AI client is not available. Check provider configuration and API keys.'
        );
      }

      const soulManager = secureYeoman.getSoulManager();

      // Resolve personality early so we can scope brain operations correctly.
      // Omnipresent personalities access the shared pool (no filter); others use per-personality scoping.
      const personality = personalityId
        ? ((await soulManager.getPersonality(personalityId)) ??
          (await soulManager.getActivePersonality()))
        : await soulManager.getActivePersonality();
      const effectivePersonalityId =
        (personality?.body?.omnipresentMind ?? false)
          ? undefined
          : (personality?.id ?? personalityId ?? undefined);

      // Gather Brain context metadata (best-effort — Brain may not be available)
      const kbMode = personality?.body?.knowledgeMode ?? 'rag';
      const kbModel = personality?.defaultModel?.model ?? '';
      const brainContext: BrainContextMeta = memoryEnabled
        ? await gatherBrainContext(
            secureYeoman,
            message,
            effectivePersonalityId,
            kbMode,
            kbModel,
            personality?.body?.notebookTokenBudget
          )
        : { memoriesUsed: 0, knowledgeUsed: 0, contextSnippets: [] };

      let systemPrompt = memoryEnabled
        ? await soulManager.composeSoulPrompt(message, personalityId, { viewportHint }, strategyId)
        : await soulManager.composeSoulPrompt(
            undefined,
            personalityId,
            { viewportHint },
            strategyId
          );

      // Inject learned preferences into system prompt (best-effort)
      if (memoryEnabled && systemPrompt) {
        systemPrompt = await applyPreferenceInjection(secureYeoman, systemPrompt);
      }

      // Inject notebook source library block when notebook/hybrid mode loaded corpus
      if (brainContext.notebookBlock) {
        systemPrompt = (systemPrompt ?? '') + '\n\n' + brainContext.notebookBlock;
      }

      // Inject inline citation instruction when enabled and sources exist (Phase 110)
      const citationsEnabled = personality?.body?.enableCitations ?? false;
      if (citationsEnabled && brainContext.sources && brainContext.sources.length > 0) {
        systemPrompt = (systemPrompt ?? '') + buildCitationInstruction(brainContext.sources);
      }

      const messages: AIRequest['messages'] = [];

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      // Append conversation history — trim old assistant messages to save tokens.
      // The most recent HISTORY_RECENT_FULL messages are kept in full; older
      // assistant messages are truncated to HISTORY_MSG_MAX_CHARS.
      if (history && Array.isArray(history)) {
        const recentStart = Math.max(0, history.length - HISTORY_RECENT_FULL);
        for (let i = 0; i < history.length; i++) {
          const msg = history[i]!;
          const role = msg.role === 'assistant' ? 'assistant' : 'user';
          if (msg.content && typeof msg.content === 'string') {
            let content = msg.content;
            if (i < recentStart && role === 'assistant' && content.length > HISTORY_MSG_MAX_CHARS) {
              content = content.slice(0, HISTORY_MSG_MAX_CHARS) + '\n…[earlier response trimmed]';
            }
            messages.push({ role, content });
          }
        }
      }

      // Append the new user message
      messages.push({ role: 'user', content: message.trim() });

      // Collect tools from personality MCP config + skill tools
      const tools: Tool[] = [];

      // Rate limiting — global chat_requests rule + optional per-personality override
      {
        const rateLimiter = secureYeoman.getRateLimiter();
        const userId = request.authUser?.userId ?? request.ip ?? 'anonymous';
        const rlCtx = { userId: request.authUser?.userId, ipAddress: request.ip };

        const rateLimitConfig = personality?.body?.resourcePolicy?.rateLimitConfig;
        const rlEnabled = rateLimitConfig?.enabled ?? true;

        if (rlEnabled) {
          // Check global rule first
          const globalResult = await Promise.resolve(
            rateLimiter.check('chat_requests', userId, rlCtx)
          );
          if (!globalResult.allowed) {
            void secureYeoman.getAuditChain().record({
              event: 'rate_limit',
              level: 'warn',
              message: 'Chat rate limit exceeded (global)',
              userId: request.authUser?.userId,
              metadata: { rule: 'chat_requests', endpoint: '/api/v1/chat' },
            });
            return sendError(reply, 429, 'Too many requests. Please slow down.');
          }

          // Per-personality override
          if (rateLimitConfig?.chatRequestsPerMinute !== undefined) {
            const ruleName = `chat_personality_${personality!.id}`;
            rateLimiter.addRule({
              name: ruleName,
              windowMs: 60000,
              maxRequests: rateLimitConfig.chatRequestsPerMinute,
              keyType: 'user',
              onExceed: 'reject',
            });
            const perResult = await Promise.resolve(rateLimiter.check(ruleName, userId, rlCtx));
            if (!perResult.allowed) {
              void secureYeoman.getAuditChain().record({
                event: 'rate_limit',
                level: 'warn',
                message: 'Chat rate limit exceeded (per-personality)',
                userId: request.authUser?.userId,
                metadata: {
                  rule: ruleName,
                  endpoint: '/api/v1/chat',
                  personalityId: personality!.id,
                },
              });
              return sendError(reply, 429, 'Too many requests for this personality.');
            }
          }
        }
      }

      // Skill-based tools — scoped to this personality + global skills
      tools.push(...(await soulManager.getActiveTools(personality?.id ?? null)));

      const mcpClient = secureYeoman.getMcpClientManager();
      const mcpStorage = secureYeoman.getMcpStorage();

      if (personality?.body?.enabled && mcpClient && mcpStorage) {
        const globalConfig = await mcpStorage.getConfig();
        const { schemasToSend, allAllowed } = selectMcpToolSchemas(
          mcpClient.getAllTools(),
          personality.body.selectedServers ?? [],
          globalConfig,
          personality.body.mcpFeatures ?? {},
          message,
          history ?? []
        );
        tools.push(...schemasToSend);

        // Phase 72: inject compact catalog into system prompt so the AI knows
        // what tools exist even when their schemas are not sent this turn.
        const catalog = buildMcpToolCatalog(allAllowed);
        const firstMsg = messages[0];
        if (catalog && firstMsg?.role === 'system') {
          messages[0] = { role: 'system', content: (firstMsg.content ?? '') + '\n\n' + catalog };
        }

        // Telemetry: log schema reduction metrics
        void secureYeoman.getAuditChain().record({
          event: 'mcp_tools_selected',
          level: 'debug',
          message: 'MCP tool schemas selected for chat request',
          metadata: {
            tools_available_count: allAllowed.length,
            tools_sent_count: schemasToSend.length,
            full_schemas: globalConfig.alwaysSendFullSchemas,
            personalityId: personality?.id,
          },
        });
      }

      // ── Cost budget check (Phase 119) ─────────────────────────────────
      const costBudget = personality?.body?.costBudget;
      if (costBudget && personality) {
        const budgetChecker = secureYeoman.getCostBudgetChecker?.();
        if (budgetChecker) {
          const budgetResult = await budgetChecker.checkBudget(personality.id, costBudget);
          if (!budgetResult.allowed) {
            return sendError(
              reply,
              429,
              `${budgetResult.blockedBy} cost budget exceeded for this personality.`
            );
          }
        }
      }

      // Proactive context compaction — summarise older turns before the API
      // call when token usage approaches the model's context-window limit.
      const currentModel = personality?.defaultModel?.model ?? 'unknown';
      const overflowStrategy = personality?.body?.contextOverflowStrategy ?? 'summarise';
      if (compactor.needsCompaction(messages, currentModel)) {
        if (overflowStrategy === 'error') {
          return sendError(reply, 413, 'Context overflow');
        } else if (overflowStrategy === 'truncate') {
          // Drop oldest non-system messages until under 80% threshold
          const nonSystem = messages.filter((m) => m.role !== 'system');
          const system = messages.filter((m) => m.role === 'system');
          while (
            nonSystem.length > 2 &&
            compactor.needsCompaction([...system, ...nonSystem], currentModel)
          ) {
            nonSystem.shift();
          }
          messages.length = 0;
          messages.push(...system, ...nonSystem);
        } else {
          // 'summarise' — default; use a cheap fast-tier model to avoid
          // paying premium-model prices for a summarisation side-call.
          try {
            const compactionResult = await compactor.compact(
              messages,
              currentModel,
              async (prompt) => {
                const summaryReq: AIRequest = {
                  messages: [{ role: 'user', content: prompt }],
                  stream: false,
                  model: COMPACTION_MODEL,
                  maxTokens: 1024,
                };
                const summaryResp = await aiClient.chat(summaryReq, {
                  source: 'context_compaction',
                });
                return summaryResp.content;
              }
            );
            if (compactionResult.compacted) {
              messages.length = 0;
              messages.push(...compactionResult.messages);
            }
          } catch (compactErr) {
            const logger = getLogger().child({ component: 'chat-routes' });
            logger.warn(
              {
                error: String(compactErr),
              },
              'Context compaction failed, proceeding with uncompacted context'
            );
          }
        }
      }

      // Read thinking config from personality body
      const thinkingBudgetTokens = personality?.body?.thinkingConfig?.enabled
        ? (personality.body.thinkingConfig.budgetTokens ?? 10000)
        : undefined;

      // Reasoning effort (Phase 119 — OpenAI o3 reasoning_effort)
      const reasoningEffort = personality?.body?.reasoningConfig?.enabled
        ? personality.body.reasoningConfig.effort
        : undefined;

      const aiRequest: AIRequest = {
        messages,
        stream: false,
        ...(tools.length > 0 ? { tools } : {}),
        ...(thinkingBudgetTokens ? { thinkingBudgetTokens } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      };

      // A/B test model override (Phase 98)
      {
        const abTestManager = secureYeoman.getAbTestManager();
        if (abTestManager && personality && conversationId) {
          const override = await abTestManager.resolveModel(personality.id, conversationId);
          if (override) aiRequest.model = override.model;
        }
      }

      // Prompt-assembly injection guard — runs after all context is assembled,
      // before the LLM call. Catches injection that survived the HTTP boundary
      // (e.g. planted in brain memory, skill instructions, or spirit context).
      {
        const guardResult = promptGuard.scan(messages, {
          userId: request.authUser?.userId,
          source: 'chat',
        });
        if (guardResult.findings.length > 0) {
          void secureYeoman.getAuditChain().record({
            event: 'injection_attempt',
            level: 'warn',
            message: 'Prompt-assembly injection pattern detected by PromptGuard',
            userId: request.authUser?.userId,
            metadata: {
              endpoint: '/api/v1/chat',
              source: 'prompt_assembly',
              findings: guardResult.findings.map((f) => ({
                pattern: f.patternName,
                role: f.messageRole,
                severity: f.severity,
              })),
            },
          });
        }
        if (!guardResult.passed) {
          return sendError(reply, 400, 'Request blocked: prompt injection pattern detected');
        }
      }

      try {
        const personalityFallbacks = personality?.modelFallbacks?.length
          ? resolvePersonalityFallbacks(personality.modelFallbacks)
          : undefined;

        // Agentic tool-execution loop.
        // When the model returns stopReason 'tool_use' we execute each tool,
        // append the results as tool-role messages, and call the model again.
        // This repeats until the model produces a final text response or we
        // hit the iteration cap (prevents infinite loops on misbehaving models).
        const MAX_TOOL_ITERATIONS = 20;
        let iterationCount = 0;

        // Accumulate thinking content across all iterations
        const thinkingParts: string[] = [];

        // Collect resource-action events to surface in the chat UI and task history.
        const creationEvents: {
          tool: string;
          label: string;
          action: string;
          name: string;
          id?: string;
        }[] = [];

        // Resolve once — used inside the tool loop to record every resource action.
        const { uuidv7, sha256 } = await import('../utils/crypto.js');
        const { TaskStatus } = await import('@secureyeoman/shared');
        const taskStorage = secureYeoman.getTaskStorage?.();

        let rawResponse = await aiClient.chat(
          aiRequest,
          { source: 'dashboard_chat' },
          personalityFallbacks
        );
        if (rawResponse.thinkingContent) thinkingParts.push(rawResponse.thinkingContent);

        while (
          rawResponse.stopReason === 'tool_use' &&
          rawResponse.toolCalls?.length &&
          iterationCount < MAX_TOOL_ITERATIONS
        ) {
          iterationCount++;

          // Append assistant's tool-call turn to the running message list,
          // including thinking blocks so they are round-tripped to the API
          messages.push({
            role: 'assistant' as const,
            content: rawResponse.content || undefined,
            toolCalls: rawResponse.toolCalls,
            thinkingBlocks: rawResponse.thinkingBlocks,
          });

          // Execute every tool call and collect results
          const executionContext = {
            personalityId: personality?.id ?? null,
            personalityName: personality?.name ?? null,
          };
          const _intentMgrForJudge = secureYeoman.getIntentManager?.() ?? null;
          for (const toolCall of rawResponse.toolCalls) {
            // ── LLM-as-Judge (Phase 54) ───────────────────────────────────────
            if (llmJudge?.shouldJudge(personality ?? null)) {
              try {
                const activeIntent = _intentMgrForJudge?.getActiveIntent?.();
                const judgeVerdict = await llmJudge.judge({
                  toolName: toolCall.name,
                  toolArgs: toolCall.arguments ?? {},
                  personality: personality ?? null,
                  intentGoals: activeIntent?.goals?.map((g) => g.name),
                  intentBoundaries: activeIntent?.hardBoundaries?.map((b) => b.rule),
                  brainContextSnippets: brainContext?.contextSnippets,
                });
                if (judgeVerdict.decision === 'block') {
                  messages.push({
                    role: 'tool' as const,
                    toolResult: {
                      toolCallId: toolCall.id,
                      content: JSON.stringify({
                        error: `[BLOCKED by LLM Judge] ${judgeVerdict.reason}`,
                      }),
                      isError: true,
                    },
                  });
                  void secureYeoman.getAuditChain().record({
                    event: 'llm_judge_block',
                    level: 'warn',
                    message: `LLM Judge blocked tool: ${toolCall.name}`,
                    metadata: {
                      tool: toolCall.name,
                      reason: judgeVerdict.reason,
                      concerns: judgeVerdict.concerns,
                    },
                  });
                  continue;
                }
                if (judgeVerdict.decision === 'warn') {
                  void secureYeoman.getAuditChain().record({
                    event: 'llm_judge_warn',
                    level: 'warn',
                    message: `LLM Judge warned for tool: ${toolCall.name}`,
                    metadata: {
                      tool: toolCall.name,
                      reason: judgeVerdict.reason,
                      concerns: judgeVerdict.concerns,
                    },
                  });
                  try {
                    await _intentMgrForJudge?.logEnforcement({
                      eventType: 'policy_warn',
                      rule: `llm_judge_warn: ${toolCall.name}`,
                      actionAttempted: toolCall.name,
                      metadata: { tool: toolCall.name, reason: judgeVerdict.reason },
                    });
                  } catch {
                    /* best-effort */
                  }
                }
              } catch {
                /* fail-open: proceed */
              }
            }

            // ── Intent enforcement (Phase 48) ────────────────────────────────
            const intentMgr = secureYeoman.getIntentManager?.();
            if (intentMgr) {
              // 1. Hard boundary check — always-block, outermost gate
              const boundaryResult = await intentMgr.checkHardBoundaries(
                `call tool: ${toolCall.name}`,
                toolCall.name
              );
              if (!boundaryResult.allowed) {
                messages.push({
                  role: 'tool' as const,
                  toolResult: {
                    toolCallId: toolCall.id,
                    content: JSON.stringify({
                      error: `[BLOCKED] Hard boundary violated: ${boundaryResult.violated?.rationale ?? boundaryResult.violated?.rule ?? 'boundary rule'}`,
                    }),
                    isError: true,
                  },
                });
                void secureYeoman.getAuditChain().record({
                  event: 'intent_boundary_violated',
                  level: 'warn',
                  message: `Hard boundary blocked tool: ${toolCall.name}`,
                  metadata: { boundaryId: boundaryResult.violated?.id, tool: toolCall.name },
                });
                continue;
              }

              // 2. Policy check — warn logs and proceeds; block halts
              const policyResult = await intentMgr.checkPolicies(
                `call tool: ${toolCall.name}`,
                toolCall.name
              );
              if (policyResult.action === 'block') {
                messages.push({
                  role: 'tool' as const,
                  toolResult: {
                    toolCallId: toolCall.id,
                    content: JSON.stringify({
                      error: `[BLOCKED] Policy: ${policyResult.violated?.rule ?? 'policy rule'}`,
                    }),
                    isError: true,
                  },
                });
                continue;
              }
              // 'warn' — already logged to enforcement log inside checkPolicies; continue dispatch

              // 3. Authorized tool check — if active intent restricts mcpTools
              const permitted = intentMgr.getPermittedMcpTools();
              if (permitted !== null && !permitted.has(toolCall.name)) {
                messages.push({
                  role: 'tool' as const,
                  toolResult: {
                    toolCallId: toolCall.id,
                    content: JSON.stringify({
                      error: `[BLOCKED] Tool '${toolCall.name}' is not in the authorized actions list for active goals.`,
                    }),
                    isError: true,
                  },
                });
                void secureYeoman.getAuditChain().record({
                  event: 'intent_action_blocked',
                  level: 'warn',
                  message: `Unauthorized tool call blocked: ${toolCall.name}`,
                  metadata: { tool: toolCall.name },
                });
                continue;
              }
            }

            // Check if this is an MCP tool and route appropriately
            const mcpTool = mcpClient?.getAllTools().find((t) => t.name === toolCall.name);
            let result: { output: unknown; isError: boolean };

            if (mcpTool) {
              try {
                const mcpResult = await mcpClient!.callTool(
                  mcpTool.serverId,
                  toolCall.name,
                  toolCall.arguments
                );
                result = { output: mcpResult, isError: false };
              } catch (err) {
                result = {
                  output: { error: toErrorMessage(err) },
                  isError: true,
                };
              }
            } else {
              result = await executeCreationTool(toolCall, secureYeoman, executionContext);
            }

            // Record every recognised resource action: sparkle card + task history entry.
            const label = CREATION_TOOL_LABELS[toolCall.name];
            if (label && !result.isError) {
              const out = result.output as Record<string, unknown>;
              const item = (out.skill ??
                out.task ??
                out.personality ??
                out.experiment ??
                out.swarm ??
                out.workflow ??
                out.run) as Record<string, unknown> | undefined;
              const args = toolCall.arguments;
              const name = String(
                item?.name ??
                  item?.workflowName ??
                  (typeof out.name === 'string' ? out.name : undefined) ??
                  (typeof args?.name === 'string' ? args.name : undefined) ??
                  (typeof args?.task === 'string' ? args.task : undefined) ??
                  toolCall.name
              );
              const action = toolAction(toolCall.name);
              const id = typeof item?.id === 'string' ? item.id : undefined;

              // Sparkle card in the chat bubble
              creationEvents.push({ tool: toolCall.name, label, action, name, id });

              // Task history entry — status is taken from the result item when
              // present (e.g. PENDING for a newly created task) or defaults to
              // COMPLETED for every other resource action.
              if (taskStorage) {
                const status =
                  typeof item?.status === 'string' ? (item.status as any) : TaskStatus.COMPLETED;
                const now = Date.now();
                await taskStorage.storeTask({
                  id: uuidv7(),
                  type: 'execute',
                  name: `${label} ${action}: ${name}`,
                  description: toolCall.name,
                  status,
                  createdAt: now,
                  ...(status === TaskStatus.COMPLETED ? { completedAt: now, durationMs: 0 } : {}),
                  inputHash: sha256(JSON.stringify(toolCall.arguments ?? {})),
                  securityContext: {
                    userId: 'ai',
                    role: 'operator',
                    permissionsUsed: [],
                    personalityId: executionContext.personalityId ?? undefined,
                    personalityName: executionContext.personalityName ?? undefined,
                  },
                  timeoutMs: 0,
                });
              }
            }

            // Capture web search results as citable sources (Phase 110)
            if (
              citationsEnabled &&
              !result.isError &&
              (toolCall.name === 'web_search' || toolCall.name === 'web_search_batch')
            ) {
              captureWebSearchSources(result.output, brainContext);
            }

            messages.push({
              role: 'tool' as const,
              toolResult: {
                toolCallId: toolCall.id,
                content: truncateToolResult(JSON.stringify(result.output)),
                isError: result.isError,
              },
            });
          }

          // Re-call the model with the updated conversation
          rawResponse = await aiClient.chat(
            { ...aiRequest, messages },
            { source: 'dashboard_chat' },
            personalityFallbacks
          );
          if (rawResponse.thinkingContent) thinkingParts.push(rawResponse.thinkingContent);
        }

        // Scan LLM response for credential leaks before returning to caller.
        const scanResult = scanner.scan(rawResponse.content, 'llm_response');
        const response = scanResult.redacted
          ? { ...rawResponse, content: scanResult.text }
          : rawResponse;

        // ── Constitutional AI — self-critique and revision ──────────────────────
        if (constitutionalEngine?.isEnabled) {
          const constMode = secureYeoman.getConfig().security.constitutional.mode;
          const userPrompt = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
          const revision = await constitutionalEngine.critiqueAndRevise(
            typeof userPrompt === 'string' ? userPrompt : '',
            response.content
          );

          if (revision.critiques.some((c) => c.violated)) {
            void secureYeoman.getAuditChain().record({
              event: 'constitutional_critique',
              level: 'info',
              message: `Constitutional critique: ${revision.critiques.filter((c) => c.violated).length} violation(s) found`,
              metadata: {
                violations: revision.critiques.filter((c) => c.violated).map((c) => c.principleId),
                revised: revision.revised,
                mode: constMode,
              },
            });
          }

          // In online mode, apply the revision
          if (constMode === 'online' && revision.revised) {
            response.content = revision.revisedResponse;
          }

          // Record preference pairs for DPO training
          if (
            revision.revised &&
            secureYeoman.getConfig().security.constitutional.recordPreferencePairs
          ) {
            try {
              const prefMgr = secureYeoman.getPreferenceManager?.();
              if (prefMgr) {
                void prefMgr.recordAnnotation({
                  prompt: typeof userPrompt === 'string' ? userPrompt : '',
                  chosen: revision.revisedResponse,
                  rejected: revision.originalResponse,
                  source: 'constitutional',
                  conversationId: conversationId ?? undefined,
                  personalityId: personality?.id,
                  metadata: {
                    critiques: revision.critiques
                      .filter((c) => c.violated)
                      .map((c) => ({ id: c.principleId, severity: c.severity })),
                    round: revision.revisionRound,
                  },
                });
              }
            } catch {
              // Non-critical — don't block response
            }
          }
        }

        // ── Guardrail Pipeline (Phase 143) — unified output filter chain ──────
        // Wraps ResponseGuard, ContentGuardrail, ToolOutputScanner + custom filters.
        if (pipelineConfig.enabled) {
          responseGuardFilter.setOptions({
            brainContext: {
              contextSnippets: brainContext?.contextSnippets,
              memoriesUsed: brainContext?.memoriesUsed,
            },
            systemPrompt,
            strictConfidentiality:
              personality?.body?.strictSystemPromptConfidentiality ??
              secureYeoman.getConfig().security.strictSystemPromptConfidentiality,
          });
          contentGuardrailFilter.setPersonalityConfig(personality?.body?.contentGuardrails);

          const pipelineResult = await guardrailPipeline.runOutput(
            response.content,
            {
              source: 'dashboard_chat',
              personalityId: personality?.id,
              conversationId: conversationId,
            },
            personality?.body?.guardrailPipeline
          );
          if (!pipelineResult.passed) {
            return sendError(reply, 400, 'Response blocked: guardrail policy violation');
          }
          if (pipelineResult.text !== response.content) {
            response.content = pipelineResult.text;
          }
        } else {
          // ── Legacy path: direct guard calls (pipeline disabled) ──────────────
          {
            const rgResult = responseGuard.scan(response.content, {
              source: 'dashboard_chat',
            });
            if (!rgResult.passed) {
              void secureYeoman.getAuditChain().record({
                event: 'response_injection_detected',
                level: 'warn',
                message: 'ResponseGuard blocked LLM response',
                metadata: {
                  findingCount: rgResult.findings.length,
                  findings: rgResult.findings.map((f) => f.patternName),
                },
              });
              return sendError(reply, 400, 'Response blocked: safety policy violation');
            }
            if (rgResult.findings.length > 0) {
              void secureYeoman.getAuditChain().record({
                event: 'response_injection_detected',
                level: 'warn',
                message: 'ResponseGuard findings in LLM response (warn mode)',
                metadata: {
                  findingCount: rgResult.findings.length,
                  findings: rgResult.findings.map((f) => f.patternName),
                },
              });
            }
            responseGuard.checkBrainConsistency(response.content, {
              contextSnippets: brainContext?.contextSnippets,
              memoriesUsed: brainContext?.memoriesUsed,
            });
            const _strictConf =
              personality?.body?.strictSystemPromptConfidentiality ??
              secureYeoman.getConfig().security.strictSystemPromptConfidentiality;
            if (_strictConf && systemPrompt) {
              const _leakResult = responseGuard.checkSystemPromptLeak(
                response.content,
                systemPrompt
              );
              if (_leakResult.hasLeak) {
                void secureYeoman.getAuditChain().record({
                  event: 'system_prompt_leak_detected',
                  level: 'warn',
                  message: 'System prompt content leak detected in response',
                  metadata: { overlapRatio: _leakResult.overlapRatio.toFixed(3) },
                });
              }
            }
          }
          {
            const cgResult = await contentGuardrail.scan(
              response.content,
              {
                source: 'dashboard_chat',
                personalityId: personality?.id,
                conversationId: conversationId,
              },
              personality?.body?.contentGuardrails
            );
            if (!cgResult.passed) {
              return sendError(reply, 400, 'Response blocked: content policy violation');
            }
            if (cgResult.text !== response.content) {
              response.content = cgResult.text;
            }
          }
        }

        // ── OPA output compliance (Phase 54) ──────────────────────────────────
        try {
          const _intentMgrNS = secureYeoman.getIntentManager?.();
          if (_intentMgrNS) {
            const complianceResult = await _intentMgrNS.checkOutputCompliance(response.content);
            if (!complianceResult.compliant) {
              void secureYeoman.getAuditChain().record({
                event: 'output_compliance_warning',
                level: 'warn',
                message: 'OPA output compliance check failed',
                metadata: { reason: complianceResult.reason },
              });
            }
          }
        } catch {
          /* best-effort */
        }

        // Assemble thinking content now so it's available for both persistence and response.
        const thinkingContent = thinkingParts.join('\n\n---\n\n') || undefined;

        // ── Grounding enforcement (Phase 110) ─────────────────────────────────
        let groundingScore: number | null = null;
        const groundednessMode = personality?.body?.groundednessMode ?? 'off';
        if (groundednessMode !== 'off' && brainContext.sources && brainContext.sources.length > 0) {
          const groundingResult = groundingChecker.check(
            response.content,
            brainContext.sources,
            groundednessMode
          );
          groundingScore = groundingResult.score;

          if (groundingResult.blocked) {
            return sendError(reply, 400, 'Response blocked: insufficient grounding in sources');
          }
          if (groundingResult.content !== response.content) {
            response.content = groundingResult.content;
          }
          // Audit low grounding scores
          if (groundingResult.score < 0.5) {
            void secureYeoman.getAuditChain().record({
              event: 'low_grounding_score',
              level: 'warn',
              message: `AI response grounding score ${groundingResult.score.toFixed(2)} below threshold`,
              metadata: {
                score: groundingResult.score,
                totalSentences: groundingResult.totalSentences,
                groundedSentences: groundingResult.groundedSentences,
                personalityId: personality?.id,
              },
            });
          }
        }

        // Persist messages to conversation storage when conversationId is provided
        if (conversationId) {
          try {
            const convStorage = secureYeoman.getConversationStorage();
            if (convStorage) {
              await convStorage.addMessage({
                conversationId,
                role: 'user',
                content: message.trim(),
                injectionScore:
                  msgValidation.injectionScore > 0 ? msgValidation.injectionScore : null,
              });
              // Build citation metadata for persistence (Phase 110)
              const citationsMeta: CitationMeta | null =
                citationsEnabled && brainContext.sources && brainContext.sources.length > 0
                  ? {
                      sources: brainContext.sources,
                      citationsEnabled: true,
                      groundednessMode,
                      groundingScore: groundingScore ?? undefined,
                    }
                  : null;

              await convStorage.addMessage({
                conversationId,
                role: 'assistant',
                content: response.content,
                model: response.model,
                provider: response.provider,
                tokensUsed: response.usage.totalTokens,
                brainContext,
                creationEvents: creationEvents.length > 0 ? creationEvents : null,
                thinkingContent: thinkingContent ?? null,
                citationsMeta,
                groundingScore,
              });
            }
          } catch {
            // Conversation storage not available — skip persistence
          }
        }

        // Optionally store the exchange as an episodic memory
        if (memoryEnabled && saveAsMemory) {
          try {
            const brainManager = secureYeoman.getBrainManager();
            await brainManager.remember(
              'episodic',
              `User: ${message.trim()}\nAssistant: ${response.content}`,
              'dashboard_chat',
              { personalityId: personalityId ?? 'default' },
              undefined,
              effectivePersonalityId
            );
          } catch {
            // Brain not available — skip memory storage
          }
        }

        // Fire-and-forget anomaly detection (Phase 96)
        try {
          const anomalyDetector = secureYeoman.getUsageAnomalyDetector?.();
          if (anomalyDetector && request.authUser?.userId) {
            anomalyDetector.recordMessage(request.authUser.userId, effectivePersonalityId);
          }
        } catch {
          // Best-effort — skip on error
        }

        // Fire-and-forget sentiment → mood feedback loop (bhava Phase 1)
        if (effectivePersonalityId && response.content) {
          soulManager
            .processSentimentFeedback(effectivePersonalityId, response.content)
            .catch(() => {});
        }

        return {
          role: 'assistant' as const,
          content: response.content,
          model: response.model,
          provider: response.provider,
          tokensUsed: response.usage.totalTokens,
          brainContext,
          conversationId: conversationId ?? undefined,
          creationEvents: creationEvents.length > 0 ? creationEvents : undefined,
          thinkingContent,
          citations:
            citationsEnabled && brainContext.sources && brainContext.sources.length > 0
              ? brainContext.sources
              : undefined,
        };
      } catch (err) {
        return sendError(reply, 502, `AI request failed: ${toErrorMessage(err)}`);
      }
    }
  );

  // ── Remember endpoint — store a message as an episodic memory ──

  app.post(
    '/api/v1/chat/remember',
    async (request: FastifyRequest<{ Body: RememberRequestBody }>, reply: FastifyReply) => {
      const { content, context } = request.body;

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return sendError(reply, 400, 'Content is required');
      }

      try {
        const brainManager = secureYeoman.getBrainManager();
        const memory = await brainManager.remember(
          'episodic',
          content.trim(),
          'dashboard_chat',
          context
        );
        return { memory };
      } catch (err) {
        return sendError(reply, 503, toErrorMessage(err));
      }
    }
  );

  // ── Feedback endpoint — record user feedback for adaptive learning ──

  app.post(
    '/api/v1/chat/feedback',
    async (request: FastifyRequest<{ Body: FeedbackRequestBody }>, reply: FastifyReply) => {
      const { conversationId, messageId, feedback, details } = request.body;

      if (!conversationId || !messageId || !feedback) {
        return sendError(reply, 400, 'conversationId, messageId, and feedback are required');
      }

      const validFeedback: FeedbackType[] = ['positive', 'negative', 'correction'];
      if (!validFeedback.includes(feedback)) {
        return sendError(reply, 400, `feedback must be one of: ${validFeedback.join(', ')}`);
      }

      try {
        const brainManager = secureYeoman.getBrainManager();
        const learner = new PreferenceLearner(brainManager);
        await learner.recordFeedback(conversationId, messageId, feedback, details);
        return { stored: true };
      } catch (err) {
        return sendError(reply, 503, toErrorMessage(err));
      }
    }
  );

  // ── Streaming chat endpoint ────────────────────────────────────────────────

  app.post(
    '/api/v1/chat/stream',
    async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const {
        message,
        history,
        personalityId,
        strategyId: strategyIdS,
        saveAsMemory,
        memoryEnabled = true,
        conversationId,
        clientContext,
      } = request.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        sendError(reply, 400, 'Message is required');
        return;
      }

      // Input validation — check message and history for injection patterns
      const validator = secureYeoman.getValidator();
      const msgValidation = validator.validate(message, { source: 'chat_stream' });

      // Abuse detection session key
      const _abUserIdS = request.authUser?.userId ?? request.ip ?? 'anonymous';
      const _abSessionIdS = `${_abUserIdS}:${conversationId ?? 'noconv'}`;

      if (msgValidation.blocked) {
        void secureYeoman.getAuditChain().record({
          event: 'injection_attempt',
          level: 'warn',
          message: 'Stream chat message blocked by input validator',
          userId: (request as FastifyRequest & { user?: { id?: string } }).user?.id,
          metadata: { endpoint: '/api/v1/chat/stream', reason: msgValidation.blockReason },
        });
        abuseDetector.recordBlock(_abSessionIdS);
        sendError(reply, 400, 'Message blocked: invalid content');
        return;
      }

      // Abuse detection: cool-down check + topic pivot recording (Phase 77)
      {
        const abCheckS = abuseDetector.check(_abSessionIdS);
        if (abCheckS.inCoolDown) {
          sendError(
            reply,
            429,
            `Temporarily rate limited due to suspicious activity. Retry after ${abCheckS.coolDownUntil}`
          );
          return;
        }
        abuseDetector.recordMessage(_abSessionIdS, message);
      }

      if (history && Array.isArray(history)) {
        for (const entry of history) {
          if (typeof entry.content === 'string') {
            const hv = validator.validate(entry.content, { source: 'chat_stream_history' });
            if (hv.blocked) {
              void secureYeoman.getAuditChain().record({
                event: 'injection_attempt',
                level: 'warn',
                message: 'Stream chat history entry blocked by input validator',
                userId: (request as FastifyRequest & { user?: { id?: string } }).user?.id,
                metadata: { endpoint: '/api/v1/chat/stream', reason: hv.blockReason },
              });
              sendError(reply, 400, 'Message blocked: invalid content in history');
              return;
            }
          }
        }
      }

      // Validate viewportHint if present
      const VALID_VIEWPORTS_S = ['mobile', 'tablet', 'desktop'] as const;
      const viewportHintS =
        clientContext?.viewportHint &&
        (VALID_VIEWPORTS_S as readonly string[]).includes(clientContext.viewportHint)
          ? clientContext.viewportHint
          : undefined;

      let aiClient;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        sendError(reply, 503, 'AI client is not available.');
        return;
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const emit = (event: ChatStreamEvent): void => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        // ── Setup (mirrors non-streaming path) ────────────────────────

        const soulManager = secureYeoman.getSoulManager();

        // Resolve personality early so we can scope brain operations correctly.
        // Omnipresent personalities access the shared pool (no filter); others use per-personality scoping.
        const personality = personalityId
          ? ((await soulManager.getPersonality(personalityId)) ??
            (await soulManager.getActivePersonality()))
          : await soulManager.getActivePersonality();
        const effectivePersonalityId =
          (personality?.body?.omnipresentMind ?? false)
            ? undefined
            : (personality?.id ?? personalityId ?? undefined);

        // Brain context
        const kbModeS = personality?.body?.knowledgeMode ?? 'rag';
        const kbModelS = personality?.defaultModel?.model ?? '';
        const brainContext: BrainContextMeta = memoryEnabled
          ? await gatherBrainContext(
              secureYeoman,
              message,
              effectivePersonalityId,
              kbModeS,
              kbModelS,
              personality?.body?.notebookTokenBudget
            )
          : { memoriesUsed: 0, knowledgeUsed: 0, contextSnippets: [] };

        let systemPrompt = memoryEnabled
          ? await soulManager.composeSoulPrompt(
              message,
              personalityId,
              {
                viewportHint: viewportHintS,
              },
              strategyIdS
            )
          : await soulManager.composeSoulPrompt(
              undefined,
              personalityId,
              {
                viewportHint: viewportHintS,
              },
              strategyIdS
            );

        // Inject learned preferences into system prompt (best-effort)
        if (memoryEnabled && systemPrompt) {
          systemPrompt = await applyPreferenceInjection(secureYeoman, systemPrompt);
        }

        // Inject notebook source library block when notebook/hybrid mode loaded corpus
        if (brainContext.notebookBlock) {
          systemPrompt = (systemPrompt ?? '') + '\n\n' + brainContext.notebookBlock;
        }

        // Inject inline citation instruction when enabled and sources exist (Phase 110)
        const citationsEnabledS = personality?.body?.enableCitations ?? false;
        if (citationsEnabledS && brainContext.sources && brainContext.sources.length > 0) {
          systemPrompt = (systemPrompt ?? '') + buildCitationInstruction(brainContext.sources);
        }

        const messages: AIRequest['messages'] = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

        if (history && Array.isArray(history)) {
          const recentStartS = Math.max(0, history.length - HISTORY_RECENT_FULL);
          for (let i = 0; i < history.length; i++) {
            const msg = history[i]!;
            const role = msg.role === 'assistant' ? 'assistant' : 'user';
            if (msg.content && typeof msg.content === 'string') {
              let content = msg.content;
              if (
                i < recentStartS &&
                role === 'assistant' &&
                content.length > HISTORY_MSG_MAX_CHARS
              ) {
                content = content.slice(0, HISTORY_MSG_MAX_CHARS) + '\n…[earlier response trimmed]';
              }
              messages.push({ role, content });
            }
          }
        }
        messages.push({ role: 'user', content: message.trim() });

        // Tools
        const tools: Tool[] = [];

        // Rate limiting — global chat_requests rule + optional per-personality override
        {
          const rateLimiter = secureYeoman.getRateLimiter();
          const userId = request.authUser?.userId ?? request.ip ?? 'anonymous';
          const rlCtx = { userId: request.authUser?.userId, ipAddress: request.ip };
          const rateLimitConfig = personality?.body?.resourcePolicy?.rateLimitConfig;
          const rlEnabled = rateLimitConfig?.enabled ?? true;

          if (rlEnabled) {
            const globalResult = await Promise.resolve(
              rateLimiter.check('chat_requests', userId, rlCtx)
            );
            if (!globalResult.allowed) {
              void secureYeoman.getAuditChain().record({
                event: 'rate_limit',
                level: 'warn',
                message: 'Stream chat rate limit exceeded (global)',
                userId: request.authUser?.userId,
                metadata: { rule: 'chat_requests', endpoint: '/api/v1/chat/stream' },
              });
              emit({ type: 'error', message: 'Rate limit exceeded. Please slow down.' });
              reply.raw.end();
              return;
            }

            if (rateLimitConfig?.chatRequestsPerMinute !== undefined) {
              const ruleName = `chat_personality_${personality!.id}`;
              rateLimiter.addRule({
                name: ruleName,
                windowMs: 60000,
                maxRequests: rateLimitConfig.chatRequestsPerMinute,
                keyType: 'user',
                onExceed: 'reject',
              });
              const perResult = await Promise.resolve(rateLimiter.check(ruleName, userId, rlCtx));
              if (!perResult.allowed) {
                void secureYeoman.getAuditChain().record({
                  event: 'rate_limit',
                  level: 'warn',
                  message: 'Stream chat rate limit exceeded (per-personality)',
                  userId: request.authUser?.userId,
                  metadata: {
                    rule: ruleName,
                    endpoint: '/api/v1/chat/stream',
                    personalityId: personality!.id,
                  },
                });
                emit({ type: 'error', message: 'Rate limit exceeded for this personality.' });
                reply.raw.end();
                return;
              }
            }
          }
        }

        tools.push(...(await soulManager.getActiveTools(personality?.id ?? null)));

        const mcpClientStream = secureYeoman.getMcpClientManager();
        const mcpStorageStream = secureYeoman.getMcpStorage();

        if (personality?.body?.enabled && mcpClientStream && mcpStorageStream) {
          const globalConfigS = await mcpStorageStream.getConfig();
          const { schemasToSend: streamSchemas, allAllowed: streamAllAllowed } =
            selectMcpToolSchemas(
              mcpClientStream.getAllTools(),
              personality.body.selectedServers ?? [],
              globalConfigS,
              personality.body.mcpFeatures ?? {},
              message,
              history ?? []
            );
          tools.push(...streamSchemas);

          // Phase 72: catalog injection for streaming handler
          const streamCatalog = buildMcpToolCatalog(streamAllAllowed);
          const streamFirstMsg = messages[0];
          if (streamCatalog && streamFirstMsg?.role === 'system') {
            messages[0] = {
              role: 'system',
              content: (streamFirstMsg.content ?? '') + '\n\n' + streamCatalog,
            };
          }

          // Telemetry
          void secureYeoman.getAuditChain().record({
            event: 'mcp_tools_selected',
            level: 'debug',
            message: 'MCP tool schemas selected for stream request',
            metadata: {
              tools_available_count: streamAllAllowed.length,
              tools_sent_count: streamSchemas.length,
              full_schemas: globalConfigS.alwaysSendFullSchemas,
              personalityId: personality?.id,
            },
          });
        }

        // ── Cost budget check (streaming, Phase 119) ──────────────
        const streamCostBudget = personality?.body?.costBudget;
        if (streamCostBudget && personality) {
          const budgetChecker = secureYeoman.getCostBudgetChecker?.();
          if (budgetChecker) {
            const budgetResult = await budgetChecker.checkBudget(personality.id, streamCostBudget);
            if (!budgetResult.allowed) {
              emit({
                type: 'error',
                message: `${budgetResult.blockedBy} cost budget exceeded for this personality.`,
              });
              reply.raw.end();
              return;
            }
          }
        }

        // Compaction — with strategy awareness (Phase 119)
        const currentModel = personality?.defaultModel?.model ?? 'unknown';
        const streamOverflowStrategy = personality?.body?.contextOverflowStrategy ?? 'summarise';
        if (compactor.needsCompaction(messages, currentModel)) {
          if (streamOverflowStrategy === 'error') {
            emit({ type: 'error', message: 'Message history exceeds model context window.' });
            reply.raw.end();
            return;
          } else if (streamOverflowStrategy === 'truncate') {
            const nonSystem = messages.filter((m) => m.role !== 'system');
            const system = messages.filter((m) => m.role === 'system');
            while (
              nonSystem.length > 2 &&
              compactor.needsCompaction([...system, ...nonSystem], currentModel)
            ) {
              nonSystem.shift();
            }
            messages.length = 0;
            messages.push(...system, ...nonSystem);
          } else {
            try {
              const compactionResult = await compactor.compact(
                messages,
                currentModel,
                async (prompt) => {
                  const summaryResp = await aiClient.chat(
                    {
                      messages: [{ role: 'user', content: prompt }],
                      stream: false,
                      model: COMPACTION_MODEL,
                      maxTokens: 1024,
                    },
                    { source: 'context_compaction' }
                  );
                  return summaryResp.content;
                }
              );
              if (compactionResult.compacted) {
                messages.length = 0;
                messages.push(...compactionResult.messages);
              }
            } catch {
              /* best-effort */
            }
          }
        }

        // Thinking config
        const streamThinkingBudget = personality?.body?.thinkingConfig?.enabled
          ? (personality.body.thinkingConfig.budgetTokens ?? 10000)
          : undefined;

        // Reasoning effort (Phase 119)
        const streamReasoningEffort = personality?.body?.reasoningConfig?.enabled
          ? personality.body.reasoningConfig.effort
          : undefined;

        const personalityFallbacks = personality?.modelFallbacks?.length
          ? resolvePersonalityFallbacks(personality.modelFallbacks)
          : undefined;
        void personalityFallbacks; // streaming path uses default provider

        const aiRequest: AIRequest = {
          messages,
          stream: true,
          ...(tools.length > 0 ? { tools } : {}),
          ...(streamThinkingBudget ? { thinkingBudgetTokens: streamThinkingBudget } : {}),
          ...(streamReasoningEffort ? { reasoningEffort: streamReasoningEffort } : {}),
        };

        // A/B test model override (Phase 98)
        {
          const abTestManager = secureYeoman.getAbTestManager();
          if (abTestManager && personality && conversationId) {
            const override = await abTestManager.resolveModel(personality.id, conversationId);
            if (override) aiRequest.model = override.model;
          }
        }

        const { uuidv7, sha256 } = await import('../utils/crypto.js');
        const { TaskStatus } = await import('@secureyeoman/shared');
        const taskStorage = secureYeoman.getTaskStorage?.();

        // Prompt-assembly injection guard — same check as non-streaming path.
        // SSE headers are already sent, so a block emits an error event and exits.
        {
          const guardResult = promptGuard.scan(messages, {
            userId: request.authUser?.userId,
            source: 'chat_stream',
          });
          if (guardResult.findings.length > 0) {
            void secureYeoman.getAuditChain().record({
              event: 'injection_attempt',
              level: 'warn',
              message: 'Prompt-assembly injection pattern detected by PromptGuard',
              userId: request.authUser?.userId,
              metadata: {
                endpoint: '/api/v1/chat/stream',
                source: 'prompt_assembly',
                findings: guardResult.findings.map((f) => ({
                  pattern: f.patternName,
                  role: f.messageRole,
                  severity: f.severity,
                })),
              },
            });
          }
          if (!guardResult.passed) {
            throw new Error('Request blocked: prompt injection pattern detected');
          }
        }

        // ── Streaming agentic loop ────────────────────────────────────

        const MAX_TOOL_ITERATIONS_S = 20;
        let iterationCountS = 0;
        const thinkingPartsS: string[] = [];
        const contentPartsS: string[] = [];
        // Track where the current iteration's content starts in contentPartsS,
        // so we only push THIS iteration's text (not all accumulated) to the
        // messages array.  Sending cumulative text caused the model to
        // re-generate the full response preamble on every continuation turn.
        let iterContentStart = 0;
        const creationEventsS: {
          tool: string;
          label: string;
          action: string;
          name: string;
          id?: string;
        }[] = [];
        const toolCallsS: {
          toolName: string;
          label: string;
          serverName?: string;
          isMcp: boolean;
        }[] = [];
        let totalTokensUsed = 0;
        let finalModel = '';
        let finalProvider = '';
        let stopReason = 'end_turn';

        while (iterationCountS <= MAX_TOOL_ITERATIONS_S) {
          // Collect tool calls and final metadata from this iteration
          const pendingToolCalls = new Map<
            string,
            { id: string; name: string; argsJson: string }
          >();
          let _currentToolId = '';
          stopReason = 'end_turn';
          // Mark start of this iteration's content so we can slice it out later
          iterContentStart = contentPartsS.length;

          // Stream model response
          for await (const chunk of aiClient.chatStream({ ...aiRequest, messages })) {
            if (chunk.type === 'thinking_delta') {
              thinkingPartsS.push(chunk.thinking);
              emit({ type: 'thinking_delta', thinking: chunk.thinking });
            } else if (chunk.type === 'content_delta') {
              contentPartsS.push(chunk.content);
              emit({ type: 'content_delta', content: chunk.content });
            } else if (chunk.type === 'tool_call_delta') {
              const tc = chunk.toolCall;
              if (tc.id && tc.name) {
                _currentToolId = tc.id;
                pendingToolCalls.set(tc.id, { id: tc.id, name: tc.name, argsJson: '' });
              }
            } else if (chunk.type === 'done') {
              stopReason = chunk.stopReason;
              if (chunk.usage) {
                totalTokensUsed += chunk.usage.totalTokens;
              }
              // Use complete tool calls from the done event (includes full args JSON)
              if (chunk.toolCalls) {
                for (const tc of chunk.toolCalls) {
                  pendingToolCalls.set(tc.id, {
                    id: tc.id,
                    name: tc.name,
                    argsJson: JSON.stringify(tc.arguments ?? {}),
                  });
                }
              }
            }
          }

          // Determine model/provider from personality config (once)
          if (!finalModel) {
            finalModel = personality?.defaultModel?.model ?? 'unknown';
            finalProvider = personality?.defaultModel?.provider ?? 'unknown';
          }

          if (stopReason !== 'tool_use' || pendingToolCalls.size === 0) break;

          // Append assistant turn with tool calls.
          // Use only THIS iteration's text (slice from iterContentStart), not the
          // full accumulated content — passing cumulative text caused the model to
          // re-state the entire response preamble on every continuation turn.
          const toolCallsForMsg = Array.from(pendingToolCalls.values()).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => {
              try {
                return JSON.parse(tc.argsJson || '{}') as Record<string, unknown>;
              } catch {
                return {};
              }
            })(),
          }));

          const iterContent = contentPartsS.slice(iterContentStart).join('');
          messages.push({
            role: 'assistant' as const,
            content: iterContent || undefined,
            toolCalls: toolCallsForMsg,
          });

          // SSE keepalive — prevents proxy/browser from closing a long-running
          // tool chain.  The colon prefix makes this a comment in SSE protocol
          // (ignored by EventSource but resets the connection timeout).
          reply.raw.write(': keepalive\n\n');

          // Execute tools
          const executionContextS = {
            personalityId: personality?.id ?? null,
            personalityName: personality?.name ?? null,
          };
          const _intentMgrJudgeS = secureYeoman.getIntentManager?.() ?? null;
          for (const toolCall of toolCallsForMsg) {
            // ── LLM-as-Judge (Phase 54) ─────────────────────────────────────
            if (llmJudge?.shouldJudge(personality ?? null)) {
              try {
                const activeIntentS = _intentMgrJudgeS?.getActiveIntent?.();
                const judgeVerdictS = await llmJudge.judge({
                  toolName: toolCall.name,
                  toolArgs: toolCall.arguments ?? {},
                  personality: personality ?? null,
                  intentGoals: activeIntentS?.goals?.map((g) => g.name),
                  intentBoundaries: activeIntentS?.hardBoundaries?.map((b) => b.rule),
                  brainContextSnippets: brainContext?.contextSnippets,
                });
                if (judgeVerdictS.decision === 'block') {
                  emit({
                    type: 'tool_result',
                    toolName: toolCall.name,
                    success: false,
                    isError: true,
                  });
                  messages.push({
                    role: 'tool' as const,
                    toolResult: {
                      toolCallId: toolCall.id,
                      content: JSON.stringify({
                        error: `[BLOCKED by LLM Judge] ${judgeVerdictS.reason}`,
                      }),
                      isError: true,
                    },
                  });
                  void secureYeoman.getAuditChain().record({
                    event: 'llm_judge_block',
                    level: 'warn',
                    message: `LLM Judge blocked tool: ${toolCall.name}`,
                    metadata: {
                      tool: toolCall.name,
                      reason: judgeVerdictS.reason,
                      concerns: judgeVerdictS.concerns,
                    },
                  });
                  continue;
                }
                if (judgeVerdictS.decision === 'warn') {
                  void secureYeoman.getAuditChain().record({
                    event: 'llm_judge_warn',
                    level: 'warn',
                    message: `LLM Judge warned for tool: ${toolCall.name}`,
                    metadata: {
                      tool: toolCall.name,
                      reason: judgeVerdictS.reason,
                      concerns: judgeVerdictS.concerns,
                    },
                  });
                }
              } catch {
                /* fail-open */
              }
            }

            const mcpToolS = mcpClientStream?.getAllTools().find((t) => t.name === toolCall.name);

            if (mcpToolS) {
              emit({
                type: 'mcp_tool_start',
                toolName: toolCall.name,
                serverName: mcpToolS.serverName,
                iteration: iterationCountS,
              });
              toolCallsS.push({
                toolName: toolCall.name,
                label: toolCall.name,
                serverName: mcpToolS.serverName,
                isMcp: true,
              });
              try {
                const mcpResult = await mcpClientStream!.callTool(
                  mcpToolS.serverId,
                  toolCall.name,
                  toolCall.arguments
                );
                emit({
                  type: 'mcp_tool_result',
                  toolName: toolCall.name,
                  serverName: mcpToolS.serverName,
                  success: true,
                });
                messages.push({
                  role: 'tool' as const,
                  toolResult: {
                    toolCallId: toolCall.id,
                    content: JSON.stringify(mcpResult),
                    isError: false,
                  },
                });
              } catch (err) {
                emit({
                  type: 'mcp_tool_result',
                  toolName: toolCall.name,
                  serverName: mcpToolS.serverName,
                  success: false,
                });
                messages.push({
                  role: 'tool' as const,
                  toolResult: {
                    toolCallId: toolCall.id,
                    content: JSON.stringify({ error: String(err) }),
                    isError: true,
                  },
                });
              }
            } else {
              const baseLabel = CREATION_TOOL_LABELS[toolCall.name] ?? toolCall.name;
              // Enrich delegation label with agent profile and task snippet
              const sArgsS = toolCall.arguments;
              const label =
                toolCall.name === 'delegate_task'
                  ? `Delegation → ${String(sArgsS?.profile ?? 'agent')}: ${String(sArgsS?.task ?? '').slice(0, 50)}`
                  : baseLabel;
              emit({
                type: 'tool_start',
                toolName: toolCall.name,
                label,
                iteration: iterationCountS,
              });
              toolCallsS.push({ toolName: toolCall.name, label, isMcp: false });
              const result = await executeCreationTool(toolCall, secureYeoman, executionContextS);
              emit({
                type: 'tool_result',
                toolName: toolCall.name,
                success: !result.isError,
                isError: result.isError,
              });

              if (!result.isError && CREATION_TOOL_LABELS[toolCall.name]) {
                const out = result.output as Record<string, unknown>;
                const item = (out.skill ??
                  out.task ??
                  out.personality ??
                  out.experiment ??
                  out.swarm ??
                  out.workflow ??
                  out.run) as Record<string, unknown> | undefined;
                const sArgs = toolCall.arguments;
                const name = String(
                  item?.name ??
                    item?.workflowName ??
                    (typeof out.name === 'string' ? out.name : undefined) ??
                    (typeof sArgs?.name === 'string' ? sArgs.name : undefined) ??
                    (typeof sArgs?.task === 'string' ? sArgs.task : undefined) ??
                    toolCall.name
                );
                const action = toolAction(toolCall.name);
                const id = typeof item?.id === 'string' ? item.id : undefined;
                const evt = { tool: toolCall.name, label, action, name, id };
                creationEventsS.push(evt);
                emit({ type: 'creation_event', event: evt });

                if (taskStorage) {
                  const status =
                    typeof item?.status === 'string' ? (item.status as any) : TaskStatus.COMPLETED;
                  const now = Date.now();
                  await taskStorage.storeTask({
                    id: uuidv7(),
                    type: 'execute',
                    name: `${label} ${action}: ${name}`,
                    description: toolCall.name,
                    status,
                    createdAt: now,
                    ...(status === TaskStatus.COMPLETED ? { completedAt: now, durationMs: 0 } : {}),
                    inputHash: sha256(JSON.stringify(toolCall.arguments ?? {})),
                    securityContext: {
                      userId: 'ai',
                      role: 'operator',
                      permissionsUsed: [],
                      personalityId: executionContextS.personalityId ?? undefined,
                      personalityName: executionContextS.personalityName ?? undefined,
                    },
                    timeoutMs: 0,
                  });
                }
              }
              // Capture web search results as citable sources (Phase 110)
              if (
                citationsEnabledS &&
                !result.isError &&
                (toolCall.name === 'web_search' || toolCall.name === 'web_search_batch')
              ) {
                captureWebSearchSources(result.output, brainContext);
              }

              messages.push({
                role: 'tool' as const,
                toolResult: {
                  toolCallId: toolCall.id,
                  content: truncateToolResult(JSON.stringify(result.output)),
                  isError: result.isError,
                },
              });
            }
          }

          iterationCountS++;
        }

        const finalContent = contentPartsS.join('');
        const finalThinking = thinkingPartsS.join('') || undefined;

        // Credential scan
        const scanResult = scanner.scan(finalContent, 'llm_response');
        let safeContent = scanResult.redacted ? scanResult.text : finalContent;

        // ── Constitutional AI — self-critique and revision (streaming post-hoc) ─
        if (constitutionalEngine?.isEnabled) {
          const constModeS = secureYeoman.getConfig().security.constitutional.mode;
          const userPromptS = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
          const revisionS = await constitutionalEngine.critiqueAndRevise(
            typeof userPromptS === 'string' ? userPromptS : '',
            safeContent
          );

          if (revisionS.critiques.some((c) => c.violated)) {
            void secureYeoman.getAuditChain().record({
              event: 'constitutional_critique',
              level: 'info',
              message: `Constitutional critique (stream): ${revisionS.critiques.filter((c) => c.violated).length} violation(s)`,
              metadata: {
                violations: revisionS.critiques.filter((c) => c.violated).map((c) => c.principleId),
                revised: revisionS.revised,
                mode: constModeS,
              },
            });
          }

          if (constModeS === 'online' && revisionS.revised) {
            safeContent = revisionS.revisedResponse;
            emit({ type: 'content_delta', content: '\n\n[Revised by Constitutional AI]' });
          }

          if (
            revisionS.revised &&
            secureYeoman.getConfig().security.constitutional.recordPreferencePairs
          ) {
            try {
              const prefMgrS = secureYeoman.getPreferenceManager?.();
              if (prefMgrS) {
                void prefMgrS.recordAnnotation({
                  prompt: typeof userPromptS === 'string' ? userPromptS : '',
                  chosen: revisionS.revisedResponse,
                  rejected: revisionS.originalResponse,
                  source: 'constitutional',
                  conversationId: conversationId ?? undefined,
                  personalityId: personality?.id,
                  metadata: {
                    critiques: revisionS.critiques
                      .filter((c) => c.violated)
                      .map((c) => ({ id: c.principleId, severity: c.severity })),
                    round: revisionS.revisionRound,
                  },
                });
              }
            } catch {
              // Non-critical
            }
          }
        }

        // ── Guardrail Pipeline (Phase 143) — unified output filter chain (stream)
        let guardrailedContent = safeContent;
        if (pipelineConfig.enabled) {
          responseGuardFilter.setOptions({
            brainContext: {
              contextSnippets: brainContext?.contextSnippets,
              memoriesUsed: brainContext?.memoriesUsed,
            },
            systemPrompt,
            strictConfidentiality:
              personality?.body?.strictSystemPromptConfidentiality ??
              secureYeoman.getConfig().security.strictSystemPromptConfidentiality,
          });
          contentGuardrailFilter.setPersonalityConfig(personality?.body?.contentGuardrails);

          const pipelineResultS = await guardrailPipeline.runOutput(
            safeContent,
            {
              source: 'dashboard_chat_stream',
              personalityId: personality?.id,
              conversationId: conversationId,
            },
            personality?.body?.guardrailPipeline
          );
          if (!pipelineResultS.passed) {
            emit({ type: 'error', message: 'Response blocked: guardrail policy violation' });
            return;
          }
          guardrailedContent = pipelineResultS.text;
        } else {
          // ── Legacy path: direct guard calls (pipeline disabled) ──────────────
          {
            const rgResult = responseGuard.scan(safeContent, { source: 'dashboard_chat_stream' });
            if (!rgResult.passed) {
              void secureYeoman.getAuditChain().record({
                event: 'response_injection_detected',
                level: 'warn',
                message: 'ResponseGuard blocked streamed LLM response',
                metadata: {
                  findingCount: rgResult.findings.length,
                  findings: rgResult.findings.map((f) => f.patternName),
                },
              });
              emit({ type: 'error', message: 'Response blocked: safety policy violation' });
              return;
            }
            if (rgResult.findings.length > 0) {
              void secureYeoman.getAuditChain().record({
                event: 'response_injection_detected',
                level: 'warn',
                message: 'ResponseGuard findings in streamed LLM response (warn mode)',
                metadata: {
                  findingCount: rgResult.findings.length,
                  findings: rgResult.findings.map((f) => f.patternName),
                },
              });
            }
            responseGuard.checkBrainConsistency(safeContent, {
              contextSnippets: brainContext?.contextSnippets,
              memoriesUsed: brainContext?.memoriesUsed,
            });
            const _strictConfS =
              personality?.body?.strictSystemPromptConfidentiality ??
              secureYeoman.getConfig().security.strictSystemPromptConfidentiality;
            if (_strictConfS && systemPrompt) {
              const _leakResultS = responseGuard.checkSystemPromptLeak(safeContent, systemPrompt);
              if (_leakResultS.hasLeak) {
                void secureYeoman.getAuditChain().record({
                  event: 'system_prompt_leak_detected',
                  level: 'warn',
                  message: 'System prompt content leak detected in streamed response',
                  metadata: { overlapRatio: _leakResultS.overlapRatio.toFixed(3) },
                });
              }
            }
          }
          {
            const cgResultS = await contentGuardrail.scan(
              safeContent,
              {
                source: 'dashboard_chat_stream',
                personalityId: personality?.id,
                conversationId: conversationId,
              },
              personality?.body?.contentGuardrails
            );
            if (!cgResultS.passed) {
              emit({ type: 'error', message: 'Response blocked: content policy violation' });
              return;
            }
            guardrailedContent = cgResultS.text;
          }
        }

        // ── OPA output compliance (Phase 54) ──────────────────────────────────
        try {
          const _intentMgrNSS = secureYeoman.getIntentManager?.();
          if (_intentMgrNSS) {
            const complianceResult = await _intentMgrNSS.checkOutputCompliance(guardrailedContent);
            if (!complianceResult.compliant) {
              void secureYeoman.getAuditChain().record({
                event: 'output_compliance_warning',
                level: 'warn',
                message: 'OPA output compliance check failed (stream)',
                metadata: { reason: complianceResult.reason },
              });
            }
          }
        } catch {
          /* best-effort */
        }

        // ── Grounding enforcement (Phase 110) — streaming path ────────────────
        let groundingScoreS: number | null = null;
        const groundednessModeSS = personality?.body?.groundednessMode ?? 'off';
        if (
          groundednessModeSS !== 'off' &&
          brainContext.sources &&
          brainContext.sources.length > 0
        ) {
          const groundingResultS = groundingChecker.check(
            guardrailedContent,
            brainContext.sources,
            groundednessModeSS
          );
          groundingScoreS = groundingResultS.score;

          if (groundingResultS.blocked) {
            emit({ type: 'error', message: 'Response blocked: insufficient grounding in sources' });
            return;
          }
          if (groundingResultS.content !== guardrailedContent) {
            guardrailedContent = groundingResultS.content;
          }
          if (groundingResultS.score < 0.5) {
            void secureYeoman.getAuditChain().record({
              event: 'low_grounding_score',
              level: 'warn',
              message: `AI stream response grounding score ${groundingResultS.score.toFixed(2)} below threshold`,
              metadata: {
                score: groundingResultS.score,
                totalSentences: groundingResultS.totalSentences,
                groundedSentences: groundingResultS.groundedSentences,
                personalityId: personality?.id,
              },
            });
          }
        }

        // Persist conversation
        if (conversationId) {
          try {
            const convStorage = secureYeoman.getConversationStorage();
            if (convStorage) {
              await convStorage.addMessage({
                conversationId,
                role: 'user',
                content: message.trim(),
                injectionScore:
                  msgValidation.injectionScore > 0 ? msgValidation.injectionScore : null,
              });
              // Build citation metadata for persistence (Phase 110)
              const citationsMetaS: CitationMeta | null =
                citationsEnabledS && brainContext.sources && brainContext.sources.length > 0
                  ? {
                      sources: brainContext.sources,
                      citationsEnabled: true,
                      groundednessMode: groundednessModeSS,
                      groundingScore: groundingScoreS ?? undefined,
                    }
                  : null;

              await convStorage.addMessage({
                conversationId,
                role: 'assistant',
                content: guardrailedContent,
                model: finalModel,
                provider: finalProvider,
                tokensUsed: totalTokensUsed,
                brainContext,
                creationEvents: creationEventsS.length > 0 ? creationEventsS : null,
                thinkingContent: finalThinking ?? null,
                toolCalls: toolCallsS.length > 0 ? toolCallsS : null,
                citationsMeta: citationsMetaS,
                groundingScore: groundingScoreS,
              });
            }
          } catch {
            /* best-effort */
          }
        }

        if (memoryEnabled && saveAsMemory) {
          try {
            const brainManager = secureYeoman.getBrainManager();
            await brainManager.remember(
              'episodic',
              `User: ${message.trim()}\nAssistant: ${guardrailedContent}`,
              'dashboard_chat',
              { personalityId: personalityId ?? 'default' },
              undefined,
              effectivePersonalityId
            );
          } catch {
            /* best-effort */
          }
        }

        // Fire-and-forget anomaly detection (Phase 96)
        try {
          const anomalyDetector = secureYeoman.getUsageAnomalyDetector?.();
          if (anomalyDetector && request.authUser?.userId) {
            anomalyDetector.recordMessage(request.authUser.userId, effectivePersonalityId);
          }
        } catch {
          // Best-effort — skip on error
        }

        // Fire-and-forget sentiment → mood feedback loop (bhava Phase 1)
        if (effectivePersonalityId && guardrailedContent) {
          soulManager
            .processSentimentFeedback(effectivePersonalityId, guardrailedContent)
            .catch(() => {});
        }

        emit({
          type: 'done',
          content: guardrailedContent,
          model: finalModel,
          provider: finalProvider,
          tokensUsed: totalTokensUsed,
          thinkingContent: finalThinking,
          creationEvents: creationEventsS,
          citations:
            citationsEnabledS && brainContext.sources && brainContext.sources.length > 0
              ? brainContext.sources
              : undefined,
        } as ChatStreamEvent);
      } catch (err) {
        emit({ type: 'error', message: toErrorMessage(err) });
      } finally {
        reply.raw.end();
      }
    }
  );
}
