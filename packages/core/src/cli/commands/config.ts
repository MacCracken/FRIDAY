/**
 * Config Command — Validate configuration and check secrets.
 */

import type { Command, CommandContext } from '../router.js';
import { extractFlag, extractBoolFlag } from '../utils.js';
import { loadConfig, validateSecrets } from '../../config/loader.js';

export const configCommand: Command = {
  name: 'config',
  aliases: ['cfg'],
  description: 'Validate configuration and check secrets',
  usage: 'secureyeoman config [--config PATH] [--check-secrets]',

  async run(ctx: CommandContext): Promise<number> {
    let argv = ctx.argv;

    const helpResult = extractBoolFlag(argv, 'help', 'h');
    if (helpResult.value) {
      ctx.stdout.write(`
Usage: ${this.usage}

Options:
  -c, --config <path>    Config file path (YAML)
      --check-secrets    Validate required environment variables
  -h, --help             Show this help
\n`);
      return 0;
    }
    argv = helpResult.rest;

    const configPathResult = extractFlag(argv, 'config', 'c');
    argv = configPathResult.rest;
    const checkSecretsResult = extractBoolFlag(argv, 'check-secrets');

    try {
      const config = loadConfig({
        configPath: configPathResult.value,
      });

      ctx.stdout.write(`Configuration valid.\n\n`);
      ctx.stdout.write(`  Environment:  ${config.core.environment}\n`);
      ctx.stdout.write(`  Gateway:      ${config.gateway.host}:${String(config.gateway.port)}\n`);
      ctx.stdout.write(`  Provider:     ${config.model.provider}\n`);
      ctx.stdout.write(`  Model:        ${config.model.model}\n`);
      ctx.stdout.write(`  Data dir:     ${config.core.dataDir}\n`);
      ctx.stdout.write(`  Workspace:    ${config.core.workspace}\n`);
      ctx.stdout.write(`  Log level:    ${config.logging.level}\n`);
      ctx.stdout.write(`  Sandbox:      ${config.security.sandbox.enabled ? 'enabled' : 'disabled'}\n`);
      ctx.stdout.write(`  Encryption:   ${config.security.encryption.enabled ? 'enabled' : 'disabled'}\n`);
      ctx.stdout.write('\n');

      if (checkSecretsResult.value) {
        try {
          validateSecrets(config);
          ctx.stdout.write('All required secrets are set.\n');
        } catch (err) {
          ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
          return 1;
        }
      }

      return 0;
    } catch (err) {
      ctx.stderr.write(`Configuration error:\n${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  },
};
