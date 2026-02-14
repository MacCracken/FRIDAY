/**
 * Marketplace Storage — SQLite local skill registry
 */

import Database from 'better-sqlite3';
import type { MarketplaceSkill } from '@friday/shared';
import { uuidv7 } from '../utils/crypto.js';

export class MarketplaceStorage {
  private db: Database.Database;

  constructor(opts: { dbPath: string }) {
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        version TEXT DEFAULT '1.0.0',
        author TEXT DEFAULT '',
        category TEXT DEFAULT 'general',
        tags TEXT DEFAULT '[]',
        download_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        instructions TEXT DEFAULT '',
        tools TEXT DEFAULT '[]',
        installed INTEGER DEFAULT 0,
        published_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  addSkill(data: Partial<MarketplaceSkill>): MarketplaceSkill {
    const now = Date.now();
    const id = data.id ?? uuidv7();
    const skill: MarketplaceSkill = {
      id, name: data.name ?? '', description: data.description ?? '', version: data.version ?? '1.0.0',
      author: data.author ?? '', category: data.category ?? 'general', tags: data.tags ?? [],
      downloadCount: data.downloadCount ?? 0, rating: data.rating ?? 0, instructions: data.instructions ?? '',
      tools: data.tools ?? [], installed: data.installed ?? false, publishedAt: data.publishedAt ?? now, updatedAt: data.updatedAt ?? now,
    };
    this.db.prepare('INSERT INTO marketplace_skills (id, name, description, version, author, category, tags, download_count, rating, instructions, tools, installed, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, skill.name, skill.description, skill.version, skill.author, skill.category, JSON.stringify(skill.tags),
      skill.downloadCount, skill.rating, skill.instructions, JSON.stringify(skill.tools), skill.installed ? 1 : 0, skill.publishedAt, skill.updatedAt,
    );
    return skill;
  }

  getSkill(id: string): MarketplaceSkill | null {
    const row = this.db.prepare('SELECT * FROM marketplace_skills WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSkill(row) : null;
  }

  search(query?: string, category?: string, limit = 20, offset = 0): { skills: MarketplaceSkill[]; total: number } {
    let sql = 'SELECT * FROM marketplace_skills WHERE 1=1';
    const params: unknown[] = [];
    if (query) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = (this.db.prepare(countSql).get(...params) as { count: number }).count;
    sql += ' ORDER BY download_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return { skills: rows.map(r => this.rowToSkill(r)), total };
  }

  setInstalled(id: string, installed: boolean): boolean {
    return this.db.prepare('UPDATE marketplace_skills SET installed = ?, updated_at = ? WHERE id = ?').run(installed ? 1 : 0, Date.now(), id).changes > 0;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM marketplace_skills WHERE id = ?').run(id).changes > 0;
  }

  private rowToSkill(row: Record<string, unknown>): MarketplaceSkill {
    return {
      id: row.id as string, name: row.name as string, description: (row.description as string) ?? '',
      version: (row.version as string) ?? '1.0.0', author: (row.author as string) ?? '',
      category: (row.category as string) ?? 'general', tags: JSON.parse((row.tags as string) || '[]'),
      downloadCount: (row.download_count as number) ?? 0, rating: (row.rating as number) ?? 0,
      instructions: (row.instructions as string) ?? '', tools: JSON.parse((row.tools as string) || '[]'),
      installed: row.installed === 1, publishedAt: row.published_at as number, updatedAt: row.updated_at as number,
    };
  }

  seedBuiltinSkills(): void {
    const BUILTIN_SKILLS = [
      {
        name: 'Summarize Text',
        description: 'Condense long text into a clear, concise summary',
        category: 'utilities',
        author: 'FRIDAY',
        version: '1.0.0',
        instructions: 'When the user asks you to summarize text, produce a concise summary that captures the key points. Structure the summary with bullet points for clarity. Keep the summary under 20% of the original length.',
        tags: ['summarize', 'text', 'utility'],
      },
      {
        name: 'Universal Script Assistant',
        description: 'Elite script consultant and developmental editor — from concept to final draft',
        category: 'creative',
        author: 'FRIDAY',
        version: '1.0.0',
        instructions: [
          'Role: You are an elite Script Consultant and Developmental Editor. Your goal is to help the user move from concept to final draft by acting as a sounding board, a critic, and a co-writer.',
          '',
          'Core Directives:',
          '- Ask, Don\'t Just Tell: Before generating large blocks of text, ask clarifying questions about character motivation, the "Central Dramatic Question," or the intended tone.',
          '- Subtext over Surface: Always prioritize what characters aren\'t saying. If asked for dialogue, ensure it feels natural and layered.',
          '- Show, Don\'t Tell: In action descriptions, focus on cinematic, visual storytelling. Avoid describing internal thoughts; describe the outward manifestations of those thoughts.',
          '- Structural Integrity: Monitor the "engine" of the story. If a scene doesn\'t move the plot forward or reveal character, flag it.',
          '- Format: Use standard screenplay formatting (Scene Headings, Action, Character, Dialogue).',
          '- Script Formatting: Always handle proper script formatting automatically without the user needing to specify it.',
          '- Insightful Questions: Help the user by asking insightful, probing questions that deepen the story.',
          '',
          'Operational Modes:',
          '- Mode: Brainstorm — Trade ideas for plot points or character flaws.',
          '- Mode: Architect — Build out the beat sheet and structural milestones.',
          '- Mode: Draft — Write or rewrite specific scenes based on the user\'s notes.',
          '- Mode: Roast — Provide harsh, honest feedback on logic gaps or clich\u00e9s.',
          '',
          'Initial Task: Acknowledge this role and ask the user about the project they are currently working on to get started.',
        ].join('\n'),
        tags: ['screenwriting', 'script', 'creative', 'dialogue', 'storytelling'],
      },
    ];
    for (const skill of BUILTIN_SKILLS) {
      const exists = this.db.prepare('SELECT 1 FROM marketplace_skills WHERE name = ? AND author = ?').get(skill.name, skill.author);
      if (!exists) {
        this.addSkill(skill);
      }
    }
  }

  close(): void { this.db.close(); }
}
