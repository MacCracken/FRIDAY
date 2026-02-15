import { describe, it, expect } from 'vitest';
import { replCommand } from './repl.js';

function createStreams() {
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdout = { write: (s: string) => { stdoutBuf += s; return true; } } as NodeJS.WritableStream;
  const stderr = { write: (s: string) => { stderrBuf += s; return true; } } as NodeJS.WritableStream;
  return { stdout, stderr, getStdout: () => stdoutBuf, getStderr: () => stderrBuf };
}

describe('repl command', () => {
  it('should print help with --help', async () => {
    const { stdout, stderr, getStdout } = createStreams();
    const code = await replCommand.run({ argv: ['--help'], stdout, stderr });
    expect(code).toBe(0);
    expect(getStdout()).toContain('--url');
  });

  it('should error when not a TTY', async () => {
    // In CI/test, stdin.isTTY is usually undefined/false
    const { stdout, stderr, getStderr } = createStreams();
    const code = await replCommand.run({ argv: [], stdout, stderr });
    expect(code).toBe(1);
    expect(getStderr()).toContain('TTY');
  });

  it('should have correct metadata', () => {
    expect(replCommand.name).toBe('repl');
    expect(replCommand.aliases).toContain('shell');
  });
});
