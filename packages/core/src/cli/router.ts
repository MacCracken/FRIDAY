/**
 * CLI Router — Zero-dependency command registry and dispatcher.
 */

export interface CommandContext {
  argv: string[];
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  run(ctx: CommandContext): Promise<number>;
}

export interface ResolvedCommand {
  command: Command;
  rest: string[];
}

export interface Router {
  register(cmd: Command): void;
  resolve(argv: string[]): ResolvedCommand;
  getCommands(): Command[];
  printHelp(stderr: NodeJS.WritableStream): void;
}

export function createRouter(defaultCommand = 'start'): Router {
  const commands = new Map<string, Command>();
  const aliases = new Map<string, string>();

  function register(cmd: Command): void {
    commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        aliases.set(alias, cmd.name);
      }
    }
  }

  function resolve(argv: string[]): ResolvedCommand {
    const sub = argv[2];

    // No subcommand or starts with '-' → default command, pass argv[2..] as rest
    if (!sub || sub.startsWith('-')) {
      const cmd = commands.get(defaultCommand);
      if (!cmd) {
        throw new Error(`Default command "${defaultCommand}" not registered`);
      }
      return { command: cmd, rest: argv.slice(2) };
    }

    // Help shortcut
    if (sub === '--help' || sub === '-h') {
      const helpCmd = commands.get('help');
      if (helpCmd) return { command: helpCmd, rest: [] };
    }

    // Version shortcut
    if (sub === '--version' || sub === '-v') {
      const cmd = commands.get(defaultCommand);
      if (!cmd) {
        throw new Error(`Default command "${defaultCommand}" not registered`);
      }
      return { command: cmd, rest: [sub] };
    }

    // Look up by name
    const byName = commands.get(sub);
    if (byName) {
      return { command: byName, rest: argv.slice(3) };
    }

    // Look up by alias
    const canonical = aliases.get(sub);
    if (canonical) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const cmd = commands.get(canonical)!;
      return { command: cmd, rest: argv.slice(3) };
    }

    // Unknown subcommand → fall through to default with full rest
    const fallback = commands.get(defaultCommand);
    if (!fallback) {
      throw new Error(`Unknown command: ${sub}`);
    }
    return { command: fallback, rest: argv.slice(2) };
  }

  function getCommands(): Command[] {
    return Array.from(commands.values());
  }

  function printHelp(stream: NodeJS.WritableStream): void {
    const lines: string[] = [
      '',
      'SecureYeoman CLI',
      '',
      'Usage: secureyeoman <command> [options]',
      '',
      'Commands:',
    ];
    for (const cmd of commands.values()) {
      const aliasStr = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : '';
      lines.push(`  ${cmd.name.padEnd(16)}${cmd.description}${aliasStr}`);
    }
    lines.push('');
    lines.push('Run "secureyeoman <command> --help" for command-specific help.');
    lines.push('');
    stream.write(lines.join('\n'));
  }

  return { register, resolve, getCommands, printHelp };
}
