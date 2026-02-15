/**
 * CLI Utilities — Flag parsing, formatting, and HTTP helpers.
 */

/** Extract a --flag value pair from argv, returning value and remaining args. */
export function extractFlag(
  argv: string[],
  flag: string,
  alias?: string,
): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === `--${flag}` || (alias && arg === `-${alias}`)) && i + 1 < argv.length) {
      value = argv[++i];
    } else if (arg !== undefined) {
      rest.push(arg);
    }
  }
  return { value, rest };
}

/** Extract a boolean --flag from argv. */
export function extractBoolFlag(
  argv: string[],
  flag: string,
  alias?: string,
): { value: boolean; rest: string[] } {
  const rest: string[] = [];
  let value = false;
  for (const arg of argv) {
    if (arg === `--${flag}` || (alias && arg === `-${alias}`)) {
      value = true;
    } else {
      rest.push(arg);
    }
  }
  return { value, rest };
}

/** Format milliseconds as human-readable uptime. */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${String(h)}h`);
  if (m > 0 || h > 0) parts.push(`${String(m)}m`);
  parts.push(`${String(s)}s`);
  return parts.join(' ');
}

/** Format rows as aligned columns. */
export function formatTable(
  rows: Record<string, string>[],
  columns?: string[],
): string {
  if (rows.length === 0) return '(no results)';

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const cols = columns ?? Object.keys(rows[0]!);
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => (r[col] ?? '').length)),
  );

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const header = cols.map((col, i) => col.toUpperCase().padEnd(widths[i]!)).join('  ');
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const separator = cols.map((_, i) => '─'.repeat(widths[i]!)).join('  ');
  const body = rows.map((row) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    cols.map((col, i) => (row[col] ?? '').padEnd(widths[i]!)).join('  '),
  );

  return [header, separator, ...body].join('\n');
}

/** Wrapper around fetch for CLI HTTP calls. */
export async function apiCall(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      throw new Error(`Connection refused: ${baseUrl} — is the server running?`);
    }
    throw new Error(`HTTP request failed: ${msg}`);
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { ok: response.ok, status: response.status, data };
}
