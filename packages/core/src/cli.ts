#!/usr/bin/env node
/**
 * SecureYeoman CLI — Entry point for running the agent + gateway.
 *
 * Usage:
 *   secureyeoman                      # Start with defaults
 *   secureyeoman --port 3001          # Custom port
 *   secureyeoman --config friday.yaml # Custom config file
 *   secureyeoman --log-level debug    # Verbose logging
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { createSecureYeoman } from './secureyeoman.js';
import type { SecureYeoman } from './secureyeoman.js';
import { isOpenSSLAvailable, generateDevCerts } from './security/cert-gen.js';

// ─── Arg parsing (minimal, no dependency) ────────────────────

interface CliArgs {
  port?: number;
  host?: string;
  config?: string;
  logLevel?: string;
  tls?: boolean;
  help?: boolean;
  version?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--port':
      case '-p':
        args.port = Number(next);
        i++;
        break;
      case '--host':
      case '-H':
        args.host = next;
        i++;
        break;
      case '--config':
      case '-c':
        args.config = next;
        i++;
        break;
      case '--log-level':
      case '-l':
        args.logLevel = next;
        i++;
        break;
      case '--tls':
        args.tls = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
SecureYeoman — Secure Autonomous Agent

Usage:
  secureyeoman [options]

Options:
  -p, --port <number>      Gateway port (default: 3000)
  -H, --host <string>      Gateway host (default: 127.0.0.1)
  -c, --config <path>      Config file path (YAML)
  -l, --log-level <level>  Log level: trace|debug|info|warn|error|fatal
      --tls                Enable TLS (auto-generates dev certs if needed)
  -v, --version            Show version
  -h, --help               Show this help

Environment Variables:
  SECUREYEOMAN_SIGNING_KEY       Audit chain signing key (required)
  SECUREYEOMAN_TOKEN_SECRET      JWT token secret (required)
  SECUREYEOMAN_ENCRYPTION_KEY    Encryption key (required)
  SECUREYEOMAN_ADMIN_PASSWORD    Admin password (required)

  ANTHROPIC_API_KEY              Anthropic API key
  OPENAI_API_KEY                 OpenAI API key
  GOOGLE_GENERATIVE_AI_API_KEY   Google Gemini API key
`);
}

// ─── Banner ──────────────────────────────────────────────────

function printBanner(host: string, port: number, tls = false): void {
  const scheme = tls ? 'https' : 'http';
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║          SecureYeoman v1.3.0              ║
  ║   Secure Autonomous Agent Framework       ║
  ╚═══════════════════════════════════════════╝

  Gateway:    ${scheme}://${host}:${port}
  Dashboard:  ${scheme}://${host}:${port} (serve dashboard build)
  Health:     ${scheme}://${host}:${port}/health
  API:        ${scheme}://${host}:${port}/api/v1/
`);
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log('secureyeoman v1.3.0');
    process.exit(0);
  }

  // Build config overrides from CLI args
  const overrides: Record<string, unknown> = {};
  if (args.port || args.host) {
    overrides.gateway = {
      ...(args.port ? { port: args.port } : {}),
      ...(args.host ? { host: args.host } : {}),
    };
  }
  if (args.logLevel) {
    overrides.logging = { level: args.logLevel };
  }

  // --tls: enable TLS, auto-generating dev certs if no paths configured
  if (args.tls) {
    const gw = (overrides.gateway ?? {}) as Record<string, unknown>;
    const tls: Record<string, unknown> = { enabled: true };

    // Auto-generate dev certs when no certPath/keyPath in overrides
    if (!gw.tls || !(gw.tls as Record<string, unknown>).certPath) {
      if (!isOpenSSLAvailable()) {
        console.error('Error: --tls requires openssl on PATH to generate dev certs');
        process.exit(1);
      }
      const certDir = path.join(os.homedir(), '.secureyeoman', 'dev-certs');
      console.log(`Generating dev TLS certificates in ${certDir} ...`);
      const certs = generateDevCerts(certDir);
      tls.certPath = certs.serverCert;
      tls.keyPath = certs.serverKey;
      tls.caPath = certs.caCert;
    }

    gw.tls = tls;
    overrides.gateway = gw;
  }

  let instance: SecureYeoman | null = null;

  try {
    instance = await createSecureYeoman({
      config: {
        configPath: args.config,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      },
      enableGateway: true,
    });

    const config = instance.getConfig();
    const host = args.host ?? config.gateway.host;
    const port = args.port ?? config.gateway.port;
    printBanner(host, port, !!args.tls);

  } catch (error) {
    console.error(
      'Failed to start SecureYeoman:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  // ─── Graceful shutdown ───────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      await instance?.shutdown();
      console.log('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
