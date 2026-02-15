import { describe, it, expect } from 'vitest';
import { createRouter } from './router.js';
import type { Command } from './router.js';

function makeCommand(name: string, aliases?: string[]): Command {
  return {
    name,
    aliases,
    description: `${name} command`,
    usage: `test ${name}`,
    run: async () => 0,
  };
}

describe('createRouter', () => {
  it('should resolve default command when no subcommand given', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));

    const result = router.resolve(['node', 'cli']);
    expect(result.command.name).toBe('start');
    expect(result.rest).toEqual([]);
  });

  it('should resolve default command when argv[2] starts with -', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));

    const result = router.resolve(['node', 'cli', '--port', '3001']);
    expect(result.command.name).toBe('start');
    expect(result.rest).toEqual(['--port', '3001']);
  });

  it('should resolve named command', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));
    router.register(makeCommand('health'));

    const result = router.resolve(['node', 'cli', 'health']);
    expect(result.command.name).toBe('health');
    expect(result.rest).toEqual([]);
  });

  it('should pass remaining args as rest for named command', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));
    router.register(makeCommand('health'));

    const result = router.resolve(['node', 'cli', 'health', '--json', '--url', 'http://localhost:3001']);
    expect(result.command.name).toBe('health');
    expect(result.rest).toEqual(['--json', '--url', 'http://localhost:3001']);
  });

  it('should resolve by alias', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));
    router.register(makeCommand('config', ['cfg']));

    const result = router.resolve(['node', 'cli', 'cfg']);
    expect(result.command.name).toBe('config');
  });

  it('should fall back to default for unknown subcommand', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));

    const result = router.resolve(['node', 'cli', 'unknown']);
    expect(result.command.name).toBe('start');
    expect(result.rest).toEqual(['unknown']);
  });

  it('should throw when default command not registered', () => {
    const router = createRouter('start');
    expect(() => router.resolve(['node', 'cli'])).toThrow('Default command "start" not registered');
  });

  it('should list registered commands', () => {
    const router = createRouter();
    router.register(makeCommand('start'));
    router.register(makeCommand('health'));

    const cmds = router.getCommands();
    expect(cmds).toHaveLength(2);
    expect(cmds.map((c) => c.name)).toEqual(['start', 'health']);
  });

  it('should print help without error', () => {
    const router = createRouter();
    router.register(makeCommand('start'));
    router.register(makeCommand('config', ['cfg']));

    let output = '';
    const stream = { write: (s: string) => { output += s; return true; } } as NodeJS.WritableStream;
    router.printHelp(stream);

    expect(output).toContain('secureyeoman');
    expect(output).toContain('start');
    expect(output).toContain('config');
    expect(output).toContain('cfg');
  });

  it('should resolve --version flag to default command', () => {
    const router = createRouter('start');
    router.register(makeCommand('start'));

    const result = router.resolve(['node', 'cli', '--version']);
    expect(result.command.name).toBe('start');
    expect(result.rest).toEqual(['--version']);
  });
});
