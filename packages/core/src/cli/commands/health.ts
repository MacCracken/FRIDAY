/**
 * Health Command — Check the health of a running SecureYeoman instance.
 */

import type { Command, CommandContext } from '../router.js';
import { extractFlag, extractBoolFlag, formatUptime, apiCall } from '../utils.js';

export const healthCommand: Command = {
  name: 'health',
  description: 'Check health of a running instance',
  usage: 'secureyeoman health [--url URL] [--json]',

  async run(ctx: CommandContext): Promise<number> {
    let argv = ctx.argv;

    const helpResult = extractBoolFlag(argv, 'help', 'h');
    if (helpResult.value) {
      ctx.stdout.write(`
Usage: ${this.usage}

Options:
      --url <url>    Server URL (default: http://127.0.0.1:3000)
      --json         Output raw JSON
  -h, --help         Show this help
\n`);
      return 0;
    }
    argv = helpResult.rest;

    const urlResult = extractFlag(argv, 'url');
    argv = urlResult.rest;
    const jsonResult = extractBoolFlag(argv, 'json');

    const baseUrl = urlResult.value ?? 'http://127.0.0.1:3000';

    try {
      const result = await apiCall(baseUrl, '/health');

      if (!result.ok) {
        ctx.stderr.write(`Health check failed (HTTP ${String(result.status)})\n`);
        return 1;
      }

      const data = result.data as Record<string, unknown>;

      if (jsonResult.value) {
        ctx.stdout.write(JSON.stringify(data, null, 2) + '\n');
        return data.status === 'ok' ? 0 : 1;
      }

      const status = data.status as string;
      const version = data.version as string;
      const uptime = data.uptime as number;
      const checks = data.checks as Record<string, boolean>;

      ctx.stdout.write(`\n  Status:   ${status === 'ok' ? 'OK' : 'ERROR'}\n`);
      ctx.stdout.write(`  Version:  ${version}\n`);
      ctx.stdout.write(`  Uptime:   ${formatUptime(uptime)}\n`);
      ctx.stdout.write(`  Server:   ${baseUrl}\n`);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (checks) {
        ctx.stdout.write('\n  Checks:\n');
        for (const [name, ok] of Object.entries(checks)) {
          ctx.stdout.write(`    ${name.padEnd(16)} ${ok ? 'pass' : 'FAIL'}\n`);
        }
      }
      ctx.stdout.write('\n');

      return status === 'ok' ? 0 : 1;
    } catch (err) {
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  },
};
