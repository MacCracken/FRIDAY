import { describe, it, expect, vi, afterEach } from 'vitest';
import { integrationCommand } from './integration.js';

function createStreams() {
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdout = { write: (s: string) => { stdoutBuf += s; return true; } } as NodeJS.WritableStream;
  const stderr = { write: (s: string) => { stderrBuf += s; return true; } } as NodeJS.WritableStream;
  return { stdout, stderr, getStdout: () => stdoutBuf, getStderr: () => stderrBuf };
}

function mockFetch(response: { ok: boolean; status: number; data: unknown }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    headers: { get: () => 'application/json' },
    json: async () => response.data,
  }));
}

describe('integration command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should print help with --help', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['--help'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('list');
    expect(getStdout()).toContain('show');
    expect(getStdout()).toContain('create');
  });

  it('should print help with no args', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('Actions');
  });

  it('should list integrations', async () => {
    mockFetch({
      ok: true,
      status: 200,
      data: {
        integrations: [
          { id: 'i1', name: 'Slack', platform: 'slack', enabled: true },
          { id: 'i2', name: 'Discord', platform: 'discord', enabled: false },
        ],
        total: 2,
        running: 1,
      },
    });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['list'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('Total: 2');
    expect(getStdout()).toContain('Slack');
    expect(getStdout()).toContain('Discord');
  });

  it('should list integrations as JSON', async () => {
    mockFetch({ ok: true, status: 200, data: { integrations: [], total: 0, running: 0 } });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['list', '--json'], stdout, stderr });
    expect(code).toBe(0);
    const parsed = JSON.parse(getStdout());
    expect(parsed.total).toBe(0);
  });

  it('should show integration details', async () => {
    mockFetch({
      ok: true,
      status: 200,
      data: {
        integration: { id: 'i1', name: 'Slack', platform: 'slack' },
        running: true,
        healthy: true,
      },
    });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['show', 'i1'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('Slack');
    expect(getStdout()).toContain('running');
  });

  it('should error on show without id', async () => {
    const { stdout, stderr, getStderr } = createStreams();
    const code = await integrationCommand.run({ argv: ['show'], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Usage');
  });

  it('should start integration', async () => {
    mockFetch({ ok: true, status: 200, data: { message: 'Integration started' } });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['start', 'i1'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('started');
  });

  it('should stop integration', async () => {
    mockFetch({ ok: true, status: 200, data: { message: 'Integration stopped' } });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['stop', 'i1'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('stopped');
  });

  it('should delete integration', async () => {
    mockFetch({ ok: true, status: 200, data: { message: 'Integration deleted' } });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({ argv: ['delete', 'i1'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('deleted');
  });

  it('should create integration', async () => {
    mockFetch({ ok: true, status: 201, data: { integration: { id: 'new' } } });

    const { stdout, stderr, getStdout } = createStreams();
    const code = await integrationCommand.run({
      argv: ['create', '--platform', 'slack', '--name', 'MySlack'],
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(getStdout()).toContain('created');
  });

  it('should error on create without required flags', async () => {
    const { stdout, stderr, getStderr } = createStreams();
    const code = await integrationCommand.run({ argv: ['create'], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Usage');
  });

  it('should error on unknown action', async () => {
    const { stdout, stderr, getStderr } = createStreams();
    const code = await integrationCommand.run({ argv: ['unknown'], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('Unknown action');
  });

  it('should handle 404 on show', async () => {
    mockFetch({ ok: false, status: 404, data: { error: 'Not found' } });

    const { stdout, stderr, getStderr } = createStreams();
    const code = await integrationCommand.run({ argv: ['show', 'missing'], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('not found');
  });
});
