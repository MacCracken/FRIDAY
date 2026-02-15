/**
 * Integration Command — Manage integrations via REST API.
 */

import type { Command, CommandContext } from '../router.js';
import { extractFlag, extractBoolFlag, formatTable, apiCall } from '../utils.js';

const USAGE = `
Usage: secureyeoman integration <action> [options]

Actions:
  list                     List all integrations
  show <id>                Show integration details
  create                   Create a new integration
  delete <id>              Delete an integration
  start <id>               Start an integration
  stop <id>                Stop an integration

Options:
      --url <url>          Server URL (default: http://127.0.0.1:3000)
      --token <token>      Auth token
      --json               Output raw JSON
      --platform <name>    Platform (for create)
      --name <name>        Name (for create)
      --config <json>      Config JSON (for create)
  -h, --help               Show this help
`;

export const integrationCommand: Command = {
  name: 'integration',
  aliases: ['int'],
  description: 'Manage integrations',
  usage: 'secureyeoman integration <action> [options]',

  async run(ctx: CommandContext): Promise<number> {
    let argv = ctx.argv;

    const helpResult = extractBoolFlag(argv, 'help', 'h');
    if (helpResult.value || argv.length === 0) {
      ctx.stdout.write(USAGE + '\n');
      return 0;
    }
    argv = helpResult.rest;

    // Extract shared flags
    const urlResult = extractFlag(argv, 'url');
    argv = urlResult.rest;
    const tokenResult = extractFlag(argv, 'token');
    argv = tokenResult.rest;
    const jsonResult = extractBoolFlag(argv, 'json');
    argv = jsonResult.rest;

    const baseUrl = urlResult.value ?? 'http://127.0.0.1:3000';
    const token = tokenResult.value;
    const jsonOutput = jsonResult.value;

    const action = argv[0];
    const actionArgs = argv.slice(1);

    try {
      switch (action) {
        case 'list':
          return await listIntegrations(ctx, baseUrl, token, jsonOutput);
        case 'show':
          return await showIntegration(ctx, baseUrl, token, jsonOutput, actionArgs);
        case 'create':
          return await createIntegration(ctx, baseUrl, token, jsonOutput, actionArgs);
        case 'delete':
          return await deleteIntegration(ctx, baseUrl, token, actionArgs);
        case 'start':
          return await startIntegration(ctx, baseUrl, token, actionArgs);
        case 'stop':
          return await stopIntegration(ctx, baseUrl, token, actionArgs);
        default:
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          ctx.stderr.write(`Unknown action: ${action}\n`);
          ctx.stderr.write(USAGE + '\n');
          return 1;
      }
    } catch (err) {
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  },
};

async function listIntegrations(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  json: boolean,
): Promise<number> {
  const result = await apiCall(baseUrl, '/api/v1/integrations', { token });
  if (!result.ok) {
    ctx.stderr.write(`Failed to list integrations (HTTP ${String(result.status)})\n`);
    return 1;
  }

  const data = result.data as { integrations: Record<string, unknown>[]; total: number; running: number };

  if (json) {
    ctx.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return 0;
  }

  ctx.stdout.write(`Total: ${String(data.total)}  Running: ${String(data.running)}\n\n`);

  if (data.integrations.length === 0) {
    ctx.stdout.write('No integrations configured.\n');
    return 0;
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

  ctx.stdout.write(formatTable(rows, ['id', 'name', 'platform', 'enabled']) + '\n');
  return 0;
}

async function showIntegration(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  json: boolean,
  args: string[],
): Promise<number> {
  const id = args[0];
  if (!id) {
    ctx.stderr.write('Usage: secureyeoman integration show <id>\n');
    return 1;
  }

  const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}`, { token });
  if (!result.ok) {
    ctx.stderr.write(result.status === 404 ? 'Integration not found.\n' : `HTTP ${String(result.status)}\n`);
    return 1;
  }

  const data = result.data as Record<string, unknown>;

  if (json) {
    ctx.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return 0;
  }

  const integration = (data.integration ?? data) as Record<string, unknown>;
  for (const [key, value] of Object.entries(integration)) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    ctx.stdout.write(`  ${key.padEnd(16)} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}\n`);
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (data.running !== undefined) ctx.stdout.write(`  ${'running'.padEnd(16)} ${String(data.running)}\n`);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (data.healthy !== undefined) ctx.stdout.write(`  ${'healthy'.padEnd(16)} ${String(data.healthy)}\n`);
  ctx.stdout.write('\n');
  return 0;
}

async function createIntegration(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  json: boolean,
  args: string[],
): Promise<number> {
  const platformResult = extractFlag(args, 'platform');
  const nameResult = extractFlag(platformResult.rest, 'name');
  const configResult = extractFlag(nameResult.rest, 'config');

  if (!platformResult.value || !nameResult.value) {
    ctx.stderr.write('Usage: secureyeoman integration create --platform <p> --name <n> [--config <json>]\n');
    return 1;
  }

  const body: Record<string, unknown> = {
    platform: platformResult.value,
    name: nameResult.value,
  };

  if (configResult.value) {
    try {
      body.config = JSON.parse(configResult.value);
    } catch {
      ctx.stderr.write('Invalid --config JSON\n');
      return 1;
    }
  }

  const result = await apiCall(baseUrl, '/api/v1/integrations', {
    method: 'POST',
    body,
    token,
  });

  if (!result.ok) {
    const errData = result.data as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    ctx.stderr.write(`Failed to create integration: ${String(errData.error ?? result.status)}\n`);
    return 1;
  }

  if (json) {
    ctx.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
  } else {
    ctx.stdout.write('Integration created.\n');
  }
  return 0;
}

async function deleteIntegration(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  args: string[],
): Promise<number> {
  const id = args[0];
  if (!id) {
    ctx.stderr.write('Usage: secureyeoman integration delete <id>\n');
    return 1;
  }

  const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });

  if (!result.ok) {
    ctx.stderr.write(result.status === 404 ? 'Integration not found.\n' : `HTTP ${String(result.status)}\n`);
    return 1;
  }

  ctx.stdout.write('Integration deleted.\n');
  return 0;
}

async function startIntegration(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  args: string[],
): Promise<number> {
  const id = args[0];
  if (!id) {
    ctx.stderr.write('Usage: secureyeoman integration start <id>\n');
    return 1;
  }

  const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    token,
  });

  if (!result.ok) {
    const errData = result.data as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    ctx.stderr.write(`Failed to start integration: ${String(errData.error ?? result.status)}\n`);
    return 1;
  }

  ctx.stdout.write('Integration started.\n');
  return 0;
}

async function stopIntegration(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  args: string[],
): Promise<number> {
  const id = args[0];
  if (!id) {
    ctx.stderr.write('Usage: secureyeoman integration stop <id>\n');
    return 1;
  }

  const result = await apiCall(baseUrl, `/api/v1/integrations/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
    token,
  });

  if (!result.ok) {
    const errData = result.data as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    ctx.stderr.write(`Failed to stop integration: ${String(errData.error ?? result.status)}\n`);
    return 1;
  }

  ctx.stdout.write('Integration stopped.\n');
  return 0;
}
