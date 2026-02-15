/**
 * REPL Command — Interactive CLI for SecureYeoman.
 */

import * as readline from 'node:readline';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import type { Command, CommandContext } from '../router.js';
import { extractFlag, extractBoolFlag, formatUptime, apiCall, formatTable } from '../utils.js';

const REPL_COMMANDS = ['health', 'config', 'integration', 'help', 'exit', 'quit'];
const INTEGRATION_ACTIONS = ['list', 'show', 'create', 'delete', 'start', 'stop'];

const HELP_TEXT = `
Available commands:
  health                          Check server health
  integration list                List integrations
  integration show <id>           Show integration details
  integration start <id>          Start an integration
  integration stop <id>           Stop an integration
  integration delete <id>         Delete an integration
  help                            Show this help
  exit, quit                      Exit the REPL
`;

export const replCommand: Command = {
  name: 'repl',
  aliases: ['shell'],
  description: 'Interactive REPL',
  usage: 'secureyeoman repl [--url URL]',

  async run(ctx: CommandContext): Promise<number> {
    let argv = ctx.argv;

    const helpResult = extractBoolFlag(argv, 'help', 'h');
    if (helpResult.value) {
      ctx.stdout.write(`
Usage: ${this.usage}

Options:
      --url <url>    Server URL (default: http://127.0.0.1:3000)
  -h, --help         Show this help
\n`);
      return 0;
    }
    argv = helpResult.rest;

    if (!process.stdin.isTTY) {
      ctx.stderr.write('Error: REPL requires an interactive terminal (TTY).\n');
      return 1;
    }

    const urlResult = extractFlag(argv, 'url');
    const baseUrl = urlResult.value ?? 'http://127.0.0.1:3000';

    // History file
    const historyDir = path.join(os.homedir(), '.secureyeoman');
    const historyFile = path.join(historyDir, 'repl_history');
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }

    // Load history
    let history: string[] = [];
    if (existsSync(historyFile)) {
      try {
        history = readFileSync(historyFile, 'utf-8').split('\n').filter(Boolean).reverse();
      } catch {
        // Ignore history read errors
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: ctx.stdout as NodeJS.WriteStream,
      prompt: 'secureyeoman> ',
      history,
      historySize: 500,
      completer: (line: string): [string[], string] => {
        const parts = line.trim().split(/\s+/);
        if (parts.length <= 1) {
          const hits = REPL_COMMANDS.filter((c) => c.startsWith(line.trim()));
          return [hits.length ? hits : REPL_COMMANDS, line];
        }
        if (parts[0] === 'integration' && parts.length === 2) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const hits = INTEGRATION_ACTIONS.filter((a) => a.startsWith(parts[1]!));
          return [hits.map((h) => `integration ${h}`), line];
        }
        return [[], line];
      },
    });

    ctx.stdout.write(`SecureYeoman REPL — connected to ${baseUrl}\n`);
    ctx.stdout.write('Type "help" for available commands, "exit" to quit.\n\n');
    rl.prompt();

    return new Promise<number>((resolve) => {
      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
          rl.prompt();
          return;
        }

        // Save to history
        try {
          appendFileSync(historyFile, trimmed + '\n');
        } catch {
          // Ignore history write errors
        }

        void handleLine(trimmed, ctx, baseUrl).then(() => {
          rl.prompt();
        });
      });

      rl.on('close', () => {
        ctx.stdout.write('\nGoodbye.\n');
        resolve(0);
      });
    });
  },
};

async function handleLine(
  line: string,
  ctx: CommandContext,
  baseUrl: string,
): Promise<void> {
  const parts = line.split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case 'exit':
    case 'quit':
      ctx.stdout.write('Goodbye.\n');
      process.exit(0);
      break;

    case 'help':
      ctx.stdout.write(HELP_TEXT);
      break;

    case 'health':
      await replHealth(ctx, baseUrl);
      break;

    case 'integration':
      await replIntegration(ctx, baseUrl, parts.slice(1));
      break;

    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      ctx.stderr.write(`Unknown command: ${cmd}. Type "help" for available commands.\n`);
  }
}

async function replHealth(ctx: CommandContext, baseUrl: string): Promise<void> {
  try {
    const result = await apiCall(baseUrl, '/health');
    if (!result.ok) {
      ctx.stderr.write(`Health check failed (HTTP ${String(result.status)})\n`);
      return;
    }
    const data = result.data as Record<string, unknown>;
    ctx.stdout.write(`  Status: ${String(data.status)}  Version: ${String(data.version)}  Uptime: ${formatUptime(data.uptime as number)}\n`);
  } catch (err) {
    ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function replIntegration(ctx: CommandContext, baseUrl: string, args: string[]): Promise<void> {
  const action = args[0];
  if (!action) {
    ctx.stderr.write('Usage: integration <list|show|start|stop|delete> [id]\n');
    return;
  }

  try {
    switch (action) {
      case 'list': {
        const result = await apiCall(baseUrl, '/api/v1/integrations');
        if (!result.ok) {
          ctx.stderr.write(`HTTP ${String(result.status)}\n`);
          return;
        }
        const data = result.data as { integrations: Record<string, unknown>[] };
        if (data.integrations.length === 0) {
          ctx.stdout.write('No integrations.\n');
          return;
        }
        const rows = data.integrations.map((i) => ({
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          id: String(i.id ?? ''),
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          name: String(i.name ?? ''),
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          platform: String(i.platform ?? ''),
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          enabled: String(i.enabled ?? ''),
        }));
        ctx.stdout.write(formatTable(rows) + '\n');
        break;
      }

      case 'show': {
        const id = args[1];
        if (!id) { ctx.stderr.write('Usage: integration show <id>\n'); return; }
        const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}`);
        if (!result.ok) {
          ctx.stderr.write(result.status === 404 ? 'Not found.\n' : `HTTP ${String(result.status)}\n`);
          return;
        }
        ctx.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        break;
      }

      case 'start':
      case 'stop': {
        const id = args[1];
        if (!id) { ctx.stderr.write(`Usage: integration ${action} <id>\n`); return; }
        const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
        if (!result.ok) {
          const errData = result.data as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          ctx.stderr.write(`Failed: ${String(errData.error ?? result.status)}\n`);
          return;
        }
        ctx.stdout.write(`Integration ${action === 'start' ? 'started' : 'stopped'}.\n`);
        break;
      }

      case 'delete': {
        const id = args[1];
        if (!id) { ctx.stderr.write('Usage: integration delete <id>\n'); return; }
        const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!result.ok) {
          ctx.stderr.write(result.status === 404 ? 'Not found.\n' : `HTTP ${String(result.status)}\n`);
          return;
        }
        ctx.stdout.write('Integration deleted.\n');
        break;
      }

      default:
        ctx.stderr.write(`Unknown integration action: ${action}\n`);
    }
  } catch (err) {
    ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  }
}
