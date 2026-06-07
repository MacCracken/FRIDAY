/**
 * Personality Command — export/import portable personality markdown files
 *
 * Sub-commands:
 *   list            List all personalities
 *   export <name>   Export a personality to markdown or JSON
 *   import <file>   Import a personality from a .md or .json file
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Command, CommandContext } from '../router.js';
import {
  extractBoolFlag,
  extractCommonFlags,
  extractFlag,
  apiCall,
  colorContext,
} from '../utils.js';

const USAGE = `
Usage: secureyeoman personality <subcommand> [options]

Subcommands:
  list                        List all personalities
  export <name>               Export personality (--format md|json, --output file)
  import <file>               Import personality from .md or .json file
  create                      Create a new personality (--wizard for guided flow)
  distill <name>              Distill personality to portable markdown
  history <name>              List version history
  tag <name> [tag]            Tag a release (auto-generates tag if omitted)
  rollback <name> <versionId> Rollback to a previous version
  drift <name>                Show uncommitted changes since last tag
  diff <name> <vA> <vB>       Diff two versions

Options:
  --format <md|json>  Export format (default: md)
  --output <file>     Write export to file instead of stdout
  --include-memory    Include memory snapshot in distillation
  --diff              Show diff between export and distilled output
  --wizard            Run interactive creation wizard
  --url <url>         Server URL (default: http://127.0.0.1:3000)
  --token <token>     Auth token
  --json              Output raw JSON
  -h, --help          Show this help
`;

export const personalityCommand: Command = {
  name: 'personality',
  aliases: ['pers'],
  description: 'Export and import portable personality files',
  usage: 'secureyeoman personality <list|export|import> [options]',

  async run(ctx: CommandContext): Promise<number> {
    let argv = ctx.argv;

    const helpResult = extractBoolFlag(argv, 'help', 'h');
    if (helpResult.value) {
      ctx.stdout.write(USAGE + '\n');
      return 0;
    }
    argv = helpResult.rest;

    const { baseUrl, token, json: jsonOutput, rest } = extractCommonFlags(argv);
    argv = rest;

    const sub = argv[0];
    const args = argv.slice(1);

    try {
      switch (sub) {
        case 'list':
        case 'ls':
          return await runList(ctx, baseUrl, token, jsonOutput);
        case 'export':
        case 'exp':
          return await runExport(ctx, baseUrl, token, jsonOutput, args);
        case 'import':
        case 'imp':
          return await runImport(ctx, baseUrl, token, jsonOutput, args);
        case 'create':
          return await runCreate(ctx, baseUrl, token, jsonOutput, args);
        case 'distill':
        case 'dist':
          return await runDistill(ctx, baseUrl, token, jsonOutput, args);
        case 'history':
          return await runHistory(ctx, baseUrl, token, jsonOutput, args);
        case 'tag':
          return await runTag(ctx, baseUrl, token, jsonOutput, args);
        case 'rollback':
          return await runRollback(ctx, baseUrl, token, jsonOutput, args);
        case 'drift':
          return await runDrift(ctx, baseUrl, token, jsonOutput, args);
        case 'diff':
          return await runDiff(ctx, baseUrl, token, jsonOutput, args);
        default:
          ctx.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`);
          return 1;
      }
    } catch (err) {
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  },
};

// ── List ─────────────────────────────────────────────────────────

async function runList(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean
): Promise<number> {
  const res = await apiCall(baseUrl, '/api/v1/soul/personalities', { token });
  const { personalities, total } = res.data as {
    personalities: {
      id: string;
      name: string;
      description: string;
      isActive: boolean;
      isDefault: boolean;
    }[];
    total: number;
  };

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify({ personalities, total }, null, 2) + '\n');
    return 0;
  }

  const c = colorContext(ctx.stdout);
  ctx.stdout.write(c.bold(`Personalities (${total})\n`));
  ctx.stdout.write('─'.repeat(72) + '\n');

  for (const p of personalities) {
    const flags: string[] = [];
    if (p.isActive) flags.push(c.green('active'));
    if (p.isDefault) flags.push(c.cyan('default'));
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    ctx.stdout.write(`  ${c.bold(p.name)}${flagStr}\n`);
    ctx.stdout.write(`    ${c.dim(p.id)}  ${p.description.slice(0, 60)}\n`);
  }
  return 0;
}

// ── Export ────────────────────────────────────────────────────────

async function runExport(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  _jsonOutput: boolean,
  args: string[]
): Promise<number> {
  let argv = args;

  const formatResult = extractFlag(argv, 'format', 'f');
  const format = formatResult.value ?? 'md';
  argv = formatResult.rest;

  const outputResult = extractFlag(argv, 'output', 'o');
  const outputFile = outputResult.value;
  argv = outputResult.rest;

  const name = argv[0];
  if (!name) {
    ctx.stderr.write(
      'Usage: secureyeoman personality export <name> [--format md|json] [--output file]\n'
    );
    return 1;
  }

  // Find personality by name
  const listRes = await apiCall(baseUrl, '/api/v1/soul/personalities', { token });
  const { personalities } = listRes.data as {
    personalities: { id: string; name: string }[];
  };
  const match = personalities.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  // Fetch export
  const url = `/api/v1/soul/personalities/${match.id}/export?format=${format}`;
  const res = await apiCall(baseUrl, url, { token });

  const content = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);

  if (outputFile) {
    writeFileSync(outputFile, content, 'utf-8');
    ctx.stdout.write(`Exported to ${outputFile}\n`);
  } else {
    ctx.stdout.write(content + '\n');
  }
  return 0;
}

// ── Import ────────────────────────────────────────────────────────

async function runImport(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const filePath = args[0];
  if (!filePath) {
    ctx.stderr.write('Usage: secureyeoman personality import <file.md|file.json>\n');
    return 1;
  }

  const content = readFileSync(filePath, 'utf-8');
  const isJson = filePath.toLowerCase().endsWith('.json');

  // For import, we parse locally and POST as JSON to the create endpoint
  // This avoids multipart complexity in the CLI
  if (isJson) {
    const data = JSON.parse(content);
    const res = await apiCall(baseUrl, '/api/v1/soul/personalities', {
      method: 'POST',
      body: data,
      token,
    });
    if (jsonOutput) {
      ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    } else {
      const personality = (res.data as { personality: { name: string; id: string } }).personality;
      ctx.stdout.write(`Imported personality: ${personality.name} (${personality.id})\n`);
    }
    return 0;
  }

  // Markdown: parse locally with the serializer, then POST
  const { PersonalityMarkdownSerializer } = await import('../../soul/personality-serializer.js');
  const serializer = new PersonalityMarkdownSerializer();
  const { data, warnings } = serializer.fromMarkdown(content);

  const res = await apiCall(baseUrl, '/api/v1/soul/personalities', {
    method: 'POST',
    body: data,
    token,
  });

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify({ ...(res.data as object), warnings }, null, 2) + '\n');
  } else {
    const personality = (res.data as { personality: { name: string; id: string } }).personality;
    ctx.stdout.write(`Imported personality: ${personality.name} (${personality.id})\n`);
    if (warnings.length > 0) {
      const c = colorContext(ctx.stdout);
      for (const w of warnings) {
        ctx.stdout.write(`  ${c.yellow('⚠')} ${w}\n`);
      }
    }
  }
  return 0;
}

// ── Distill ──────────────────────────────────────────────────────

async function runDistill(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  let argv = args;

  const includeMemResult = extractBoolFlag(argv, 'include-memory');
  const includeMemory = includeMemResult.value;
  argv = includeMemResult.rest;

  const diffResult = extractBoolFlag(argv, 'diff');
  const showDiff = diffResult.value;
  argv = diffResult.rest;

  const outputResult = extractFlag(argv, 'output', 'o');
  const outputFile = outputResult.value;
  argv = outputResult.rest;

  const name = argv[0];
  if (!name) {
    ctx.stderr.write(
      'Usage: secureyeoman personality distill <name> [--include-memory] [--output file] [--diff]\n'
    );
    return 1;
  }

  // Find personality by name
  const listRes = await apiCall(baseUrl, '/api/v1/soul/personalities', { token });
  const { personalities } = listRes.data as { personalities: { id: string; name: string }[] };
  const match = personalities.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  if (showDiff) {
    const url = `/api/v1/soul/personalities/${match.id}/distill/diff`;
    const res = await apiCall(baseUrl, url, { token });
    const diffData = res.data as { diff: string; hasChanges: boolean };
    if (jsonOutput) {
      ctx.stdout.write(JSON.stringify(diffData, null, 2) + '\n');
    } else if (diffData.hasChanges) {
      ctx.stdout.write(diffData.diff + '\n');
    } else {
      ctx.stdout.write('No differences found.\n');
    }
    return 0;
  }

  const qs = includeMemory ? '?includeMemory=true' : '';
  const url = `/api/v1/soul/personalities/${match.id}/distill${qs}`;
  const res = await apiCall(baseUrl, url, { token });
  const result = res.data as { markdown: string; metadata: Record<string, unknown> };

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  if (outputFile) {
    writeFileSync(outputFile, result.markdown, 'utf-8');
    ctx.stdout.write(`Distilled personality written to ${outputFile}\n`);
  } else {
    ctx.stdout.write(result.markdown);
  }
  return 0;
}

// ── Create ───────────────────────────────────────────────────────

async function runCreate(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const argv = args;

  const wizardResult = extractBoolFlag(argv, 'wizard');
  const useWizard = wizardResult.value;

  if (!useWizard) {
    ctx.stderr.write('Usage: secureyeoman personality create --wizard\n');
    ctx.stderr.write('  The --wizard flag enables the interactive creation flow.\n');
    return 1;
  }

  // Interactive wizard using process.stdin
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: ctx.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(prompt, resolve);
    });

  const askChoice = async (prompt: string, choices: string[]): Promise<string> => {
    const choiceStr = choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
    ctx.stdout.write(`${prompt}\n${choiceStr}\n`);
    const answer = await ask('Choice (number or text): ');
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx]!;
    return answer.trim() || choices[0]!;
  };

  try {
    const c = colorContext(ctx.stdout);
    ctx.stdout.write(c.bold('\nPersonality Creation Wizard\n'));
    ctx.stdout.write('─'.repeat(40) + '\n\n');

    // 1. Name
    const name = await ask("What is this personality's name? ");
    if (!name.trim()) {
      ctx.stderr.write('Name is required.\n');
      return 1;
    }

    // 2. System prompt
    const systemPrompt = await ask("Describe this personality's mission (system prompt): ");

    // 3. Topics
    const topicsRaw = await ask('What topics should it focus on? (comma-separated or blank): ');
    const description = topicsRaw.trim() || `${name.trim()} personality`;

    // 4. Tone and style
    const formality = await askChoice('What tone and communication style?', [
      'casual',
      'balanced',
      'formal',
    ]);
    const humor = await askChoice('Humor level?', ['none', 'subtle', 'witty']);
    const verbosity = await askChoice('Verbosity?', ['concise', 'balanced', 'detailed']);

    // 5. Reasoning
    const reasoning = await askChoice('What reasoning style should it use?', [
      'analytical',
      'creative',
      'balanced',
    ]);

    // 6. Constraints
    const constraints = await ask('Any constraints or guardrails? (free text, blank to skip): ');

    rl.close();

    // Build personality
    const fullPrompt = constraints.trim()
      ? `${systemPrompt.trim()}\n\nConstraints:\n${constraints.trim()}`
      : systemPrompt.trim();

    const body = {
      name: name.trim(),
      description,
      systemPrompt: fullPrompt,
      traits: { formality, humor, verbosity, reasoning },
      sex: 'unspecified',
      voice: '',
      preferredLanguage: '',
      defaultModel: null,
      modelFallbacks: [],
      includeArchetypes: true,
      injectDateTime: false,
      empathyResonance: false,
      avatarUrl: null,
    };

    const res = await apiCall(baseUrl, '/api/v1/soul/personalities', {
      method: 'POST',
      body,
      token,
    });

    const personality = (res.data as { personality: { name: string; id: string } }).personality;

    if (jsonOutput) {
      ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    } else {
      ctx.stdout.write('\n' + c.bold(`Created personality: ${personality.name}`) + '\n');
      ctx.stdout.write(`  ID: ${personality.id}\n`);
      ctx.stdout.write(`  Traits: ${formality}, ${humor}, ${verbosity}, ${reasoning}\n`);
    }
    return 0;
  } finally {
    rl.close();
  }
}

// ── Version helpers ───────────────────────────────────────────

async function resolvePersonalityId(
  baseUrl: string,
  token: string | undefined,
  name: string
): Promise<string | null> {
  const listRes = await apiCall(baseUrl, '/api/v1/soul/personalities', { token });
  const { personalities } = listRes.data as { personalities: { id: string; name: string }[] };
  const match = personalities.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return match?.id ?? null;
}

// ── History ───────────────────────────────────────────────────

async function runHistory(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const name = args[0];
  if (!name) {
    ctx.stderr.write('Usage: secureyeoman personality history <name>\n');
    return 1;
  }

  const id = await resolvePersonalityId(baseUrl, token, name);
  if (!id) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  const res = await apiCall(baseUrl, `/api/v1/soul/personalities/${id}/versions`, { token });
  const { versions, total } = res.data as {
    versions: {
      id: string;
      versionTag: string | null;
      changedFields: string[];
      author: string;
      createdAt: number;
    }[];
    total: number;
  };

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    return 0;
  }

  const c = colorContext(ctx.stdout);
  ctx.stdout.write(c.bold(`Version history for ${name}`) + ` (${total} versions)\n\n`);
  for (const v of versions) {
    const tag = v.versionTag ? c.green(v.versionTag) : c.dim('untagged');
    const date = new Date(v.createdAt).toISOString().slice(0, 19);
    const fields = v.changedFields.length > 0 ? ` [${v.changedFields.join(', ')}]` : '';
    ctx.stdout.write(
      `  ${tag}  ${c.dim(date)}  ${v.author}${fields}  ${c.dim(v.id.slice(0, 8))}\n`
    );
  }
  return 0;
}

// ── Tag ───────────────────────────────────────────────────────

async function runTag(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const name = args[0];
  if (!name) {
    ctx.stderr.write('Usage: secureyeoman personality tag <name> [tag]\n');
    return 1;
  }

  const id = await resolvePersonalityId(baseUrl, token, name);
  if (!id) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  const body: Record<string, unknown> = {};
  if (args[1]) body.tag = args[1];

  const res = await apiCall(baseUrl, `/api/v1/soul/personalities/${id}/versions/tag`, {
    method: 'POST',
    body,
    token,
  });

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    return 0;
  }

  const version = res.data as { versionTag: string; id: string };
  const c = colorContext(ctx.stdout);
  ctx.stdout.write(
    c.bold(`Tagged release: ${version.versionTag}`) + ` (${version.id.slice(0, 8)})\n`
  );
  return 0;
}

// ── Rollback ──────────────────────────────────────────────────

async function runRollback(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const [name, versionId] = args;
  if (!name || !versionId) {
    ctx.stderr.write('Usage: secureyeoman personality rollback <name> <versionId>\n');
    return 1;
  }

  const id = await resolvePersonalityId(baseUrl, token, name);
  if (!id) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  const res = await apiCall(
    baseUrl,
    `/api/v1/soul/personalities/${id}/versions/${versionId}/rollback`,
    { method: 'POST', token }
  );

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    return 0;
  }

  const c = colorContext(ctx.stdout);
  ctx.stdout.write(c.bold('Rollback complete.') + ' New version recorded.\n');
  return 0;
}

// ── Drift ─────────────────────────────────────────────────────

async function runDrift(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const name = args[0];
  if (!name) {
    ctx.stderr.write('Usage: secureyeoman personality drift <name>\n');
    return 1;
  }

  const id = await resolvePersonalityId(baseUrl, token, name);
  if (!id) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  const res = await apiCall(baseUrl, `/api/v1/soul/personalities/${id}/drift`, { token });

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    return 0;
  }

  const drift = res.data as {
    lastTaggedVersion: string | null;
    uncommittedChanges: number;
    changedFields: string[];
    diffSummary: string;
  };
  const c = colorContext(ctx.stdout);

  if (!drift.lastTaggedVersion) {
    ctx.stdout.write('No tagged releases yet.\n');
    return 0;
  }

  ctx.stdout.write(c.bold(`Last tagged: ${drift.lastTaggedVersion}\n`));
  if (drift.uncommittedChanges === 0) {
    ctx.stdout.write(c.green('No drift detected.\n'));
  } else {
    ctx.stdout.write(c.yellow(`${drift.uncommittedChanges} uncommitted change(s)`) + '\n');
    ctx.stdout.write(`Changed fields: ${drift.changedFields.join(', ')}\n`);
    if (drift.diffSummary) {
      ctx.stdout.write('\n' + drift.diffSummary + '\n');
    }
  }
  return 0;
}

// ── Diff ──────────────────────────────────────────────────────

async function runDiff(
  ctx: CommandContext,
  baseUrl: string,
  token: string | undefined,
  jsonOutput: boolean,
  args: string[]
): Promise<number> {
  const [name, vA, vB] = args;
  if (!name || !vA || !vB) {
    ctx.stderr.write('Usage: secureyeoman personality diff <name> <versionA> <versionB>\n');
    return 1;
  }

  const id = await resolvePersonalityId(baseUrl, token, name);
  if (!id) {
    ctx.stderr.write(`Personality not found: ${name}\n`);
    return 1;
  }

  const res = await apiCall(baseUrl, `/api/v1/soul/personalities/${id}/versions/${vA}/diff/${vB}`, {
    token,
  });

  if (jsonOutput) {
    ctx.stdout.write(JSON.stringify(res.data, null, 2) + '\n');
    return 0;
  }

  const { diff } = res.data as { diff: string };
  if (!diff) {
    ctx.stdout.write('No differences.\n');
  } else {
    ctx.stdout.write(diff + '\n');
  }
  return 0;
}
