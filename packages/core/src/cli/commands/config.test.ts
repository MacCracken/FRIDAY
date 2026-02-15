import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configCommand } from './config.js';

function createStreams() {
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdout = { write: (s: string) => { stdoutBuf += s; return true; } } as NodeJS.WritableStream;
  const stderr = { write: (s: string) => { stderrBuf += s; return true; } } as NodeJS.WritableStream;
  return { stdout, stderr, getStdout: () => stdoutBuf, getStderr: () => stderrBuf };
}

describe('config command', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should print help with --help', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await configCommand.run({ argv: ['--help'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('--config');
    expect(getStdout()).toContain('--check-secrets');
  });

  it('should validate default config successfully', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await configCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('Configuration valid');
    expect(getStdout()).toContain('Environment:');
    expect(getStdout()).toContain('Gateway:');
    expect(getStdout()).toContain('Provider:');
  });

  it('should fail for non-existent config path', async () => {
    const { stdout, stderr, getStderr } = createStreams();
    const code = await configCommand.run({
      argv: ['--config', '/nonexistent/config.yaml'],
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Config file not found');
  });

  it('should report missing secrets with --check-secrets', async () => {
    // Clear all secrets
    delete process.env.SECUREYEOMAN_SIGNING_KEY;
    delete process.env.SECUREYEOMAN_TOKEN_SECRET;
    delete process.env.SECUREYEOMAN_ENCRYPTION_KEY;
    delete process.env.SECUREYEOMAN_ADMIN_PASSWORD;
    delete process.env.ANTHROPIC_API_KEY;

    const { stdout, stderr, getStderr } = createStreams();
    const code = await configCommand.run({
      argv: ['--check-secrets'],
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Missing required secrets');
  });
});
