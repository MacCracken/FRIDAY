import { describe, it, expect, vi, afterEach } from 'vitest';
import { healthCommand } from './health.js';

function createStreams() {
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdout = { write: (s: string) => { stdoutBuf += s; return true; } } as NodeJS.WritableStream;
  const stderr = { write: (s: string) => { stderrBuf += s; return true; } } as NodeJS.WritableStream;
  return { stdout, stderr, getStdout: () => stdoutBuf, getStderr: () => stderrBuf };
}

describe('health command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should print help with --help', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await healthCommand.run({ argv: ['--help'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('--url');
    expect(getStdout()).toContain('--json');
  });

  it('should display health status on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        status: 'ok',
        version: '1.5.1',
        uptime: 135000,
        checks: { database: true, auditChain: true },
      }),
    }));

    const { stdout, stderr, getStdout } = createStreams();
    const code = await healthCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('OK');
    expect(getStdout()).toContain('1.5.1');
    expect(getStdout()).toContain('2m 15s');
    expect(getStdout()).toContain('database');
  });

  it('should output JSON with --json flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok', version: '1.5.1', uptime: 1000 }),
    }));

    const { stdout, stderr, getStdout } = createStreams();
    const code = await healthCommand.run({ argv: ['--json'], stdout, stderr });
    expect(code).toBe(0);
    const parsed = JSON.parse(getStdout());
    expect(parsed.status).toBe('ok');
  });

  it('should return 1 on connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const { stdout, stderr, getStderr } = createStreams();
    const code = await healthCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Connection refused');
  });

  it('should return 1 when status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'error', version: '1.5.1', uptime: 0 }),
    }));

    const { stdout, stderr } = createStreams();
    const code = await healthCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(1);
  });
});
