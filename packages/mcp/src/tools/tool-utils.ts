/**
 * Tool utilities — shared helpers for wrapping tool handlers with middleware.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import type { CoreApiClient } from '../core-client.js';
import type { ToolMiddleware } from './index.js';

/**
 * Global tool registry — populated by wrapToolHandler so the MCP server can
 * expose an internal callthrough endpoint without going through the full MCP
 * protocol (init → tools/call → close). Used by core's McpClientManager.callTool().
 */
export const globalToolRegistry = new Map<
  string,
  (args: Record<string, unknown>) => Promise<ToolResult>
>();

/** Clear the global tool registry. Call on server re-init to prevent stale entries. */
export function clearGlobalToolRegistry(): void {
  globalToolRegistry.clear();
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function wrapToolHandler<T extends Record<string, unknown>>(
  toolName: string,
  middleware: ToolMiddleware,
  handler: (args: T) => Promise<ToolResult>
): (args: T) => Promise<ToolResult> {
  const wrapped = async (args: T): Promise<ToolResult> => {
    // 1. Rate limit check
    const rateResult = middleware.rateLimiter.check(toolName);
    if (!rateResult.allowed) {
      return {
        content: [
          {
            type: 'text',
            text: `Rate limit exceeded for "${toolName}". Retry after ${rateResult.retryAfterMs}ms.`,
          },
        ],
        isError: true,
      };
    }

    // 2. Input validation
    const validation = middleware.inputValidator.validate(args);
    if (validation.blocked) {
      return {
        content: [
          {
            type: 'text',
            text: `Input blocked: ${validation.blockReason ?? 'Injection detected'}`,
          },
        ],
        isError: true,
      };
    }

    // 3. Execute with audit logging
    try {
      const result = await middleware.auditLogger.wrap(toolName, args, async () => {
        return handler(args);
      });

      // 4. Redact secrets from output
      const redacted = middleware.secretRedactor.redact(result) as ToolResult;
      return redacted;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" failed: ${message}` }],
        isError: true,
      };
    }
  };

  // Register in the global callthrough registry so the internal tool-call
  // endpoint can invoke handlers without going through the MCP protocol.
  globalToolRegistry.set(
    toolName,
    wrapped as (args: Record<string, unknown>) => Promise<ToolResult>
  );

  return wrapped;
}

// ── Shared Response Helpers ──────────────────────────────────────────────────

/** Wrap any data as a JSON-formatted MCP tool result. */
export function jsonResponse(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Return a labelled text block (e.g. "Agent Details\n---\n{...}"). */
export function labelledResponse(label: string, body: unknown): ToolResult {
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return { content: [{ type: 'text' as const, text: `${label}\n---\n${text}` }] };
}

/** Return a plain text MCP tool result. */
export function textResponse(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

/** Return an error MCP tool result. */
export function errorResponse(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/**
 * Check an HttpResult and return an error ToolResult if the request failed,
 * or null if it succeeded.  Eliminates the repeated
 *   `if (!ok) return errorResponse(\`… failed: HTTP ${status}\n${JSON.stringify(body)}\`)`
 * boilerplate across tool files.
 */
export function checkHttpOk(result: HttpResult, context: string): ToolResult | null {
  if (result.ok) return null;
  return errorResponse(`${context}: HTTP ${result.status}\n${JSON.stringify(result.body)}`);
}

// ── Query Builder ───────────────────────────────────────────────────────────

/**
 * Build a query string object from tool args, including only defined/non-null values.
 * Numbers are converted to strings automatically.
 */
export function buildQueryFromArgs(
  args: Record<string, unknown>,
  keys: string[]
): Record<string, string> {
  const q: Record<string, string> = {};
  for (const key of keys) {
    const val = args[key];
    if (val !== undefined && val !== null) {
      q[key] = typeof val === 'string' ? val : String(val);
    }
  }
  return q;
}

// ── Disabled Tool Stub ──────────────────────────────────────────────────────

/**
 * Register a single disabled-status stub tool. Used when a feature flag is off.
 * Replaces the boilerplate each tool file repeats for the disabled case.
 */
export function registerDisabledStub(
  server: McpServer,
  middleware: ToolMiddleware,
  toolName: string,
  message: string
): void {
  server.registerTool(
    toolName,
    { description: `(disabled) ${message}`, inputSchema: {} },
    wrapToolHandler(toolName, middleware, async () => errorResponse(message))
  );
}

// ── Generic HTTP Client ─────────────────────────────────────────────────────

export interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Parse a fetch Response body, preferring JSON, falling back to text. */
export async function parseResponseBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return await res.text().catch(() => '');
  }
}

/**
 * Minimal HTTP client factory for tool files that call external REST APIs.
 * Eliminates the repeated get/post/put/delete helpers in agnos-tools,
 * agnostic-tools, trading-tools, etc.
 */
export function createHttpClient(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
  const base = baseUrl.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json', ...defaultHeaders };

  async function request(method: string, path: string, body?: unknown): Promise<HttpResult> {
    const opts: RequestInit = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${base}${path}`, opts);
    return { ok: res.ok, status: res.status, body: await parseResponseBody(res) };
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    put: (path: string, body?: unknown) => request('PUT', path, body),
    delete: (path: string) => request('DELETE', path),
    patch: (path: string, body?: unknown) => request('PATCH', path, body),
  };
}

// ── API Proxy Tool Factory ────────────────────────────────────────────────────

/**
 * Definition for a simple API-proxy tool: GET/POST/PUT/DELETE → JSON response.
 *
 * Covers the most common pattern across tool files:
 *   server.registerTool(name, { description, inputSchema },
 *     wrapToolHandler(name, middleware, async (args) => {
 *       const result = await client.get(path, query);
 *       return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
 *     })
 *   );
 */
export interface ApiProxyToolDef<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  method?: 'get' | 'post' | 'put' | 'delete';
  /** Build the request path (may embed args for path params). */
  buildPath: (args: T) => string;
  /** Build query string params for GET requests. */
  buildQuery?: (args: T) => Record<string, string>;
  /** Build the request body for POST/PUT requests. */
  buildBody?: (args: T) => unknown;
}

/**
 * Register a single API-proxy MCP tool.
 *
 * Handles the registerTool + wrapToolHandler boilerplate so callers only
 * need to describe what the tool does and how to map args to an API call.
 */
export function registerApiProxyTool<T extends Record<string, unknown>>(
  server: McpServer,
  client: CoreApiClient,
  middleware: ToolMiddleware,
  def: ApiProxyToolDef<T>
): void {
  const { name, description, inputSchema, method = 'get', buildPath, buildQuery, buildBody } = def;

  server.registerTool(
    name,
    { description, inputSchema },

    wrapToolHandler(name, middleware, async (args: any) => {
      const typedArgs = args as T;
      const path = buildPath(typedArgs);
      let result: unknown;

      if (method === 'get') {
        const query = buildQuery ? buildQuery(typedArgs) : undefined;
        result = await client.get(path, query);
      } else if (method === 'post') {
        result = await client.post(path, buildBody ? buildBody(typedArgs) : typedArgs);
      } else if (method === 'put') {
        result = await client.put(path, buildBody ? buildBody(typedArgs) : typedArgs);
      } else {
        result = await client.delete(path);
      }

      return jsonResponse(result);
    })
  );
}
