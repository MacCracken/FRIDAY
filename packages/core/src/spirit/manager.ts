/**
 * SpiritManager — Manages passions, inspirations, and pains.
 *
 * The Spirit represents the agent's emotional core: what drives it,
 * what inspires it, and what causes it distress. It sits between
 * Soul (who the agent is) and Brain (what the agent knows).
 */

import type { SpiritStorage } from './storage.js';
import type { SoulManager } from '../soul/manager.js';
import type {
  SpiritConfig,
  Passion,
  PassionCreate,
  PassionUpdate,
  Inspiration,
  InspirationCreate,
  InspirationUpdate,
  Pain,
  PainCreate,
  PainUpdate,
  SpiritManagerDeps,
} from './types.js';

export interface SpiritStats {
  passions: { total: number; active: number };
  inspirations: { total: number; active: number };
  pains: { total: number; active: number };
}

export class SpiritManager {
  private readonly storage: SpiritStorage;
  private readonly config: SpiritConfig;
  private readonly deps: SpiritManagerDeps;
  private readonly soul: SoulManager | null;

  constructor(storage: SpiritStorage, config: SpiritConfig, deps: SpiritManagerDeps, soul?: SoulManager) {
    this.storage = storage;
    this.config = config;
    this.deps = deps;
    this.soul = soul ?? null;
  }

  // ── Passion Ops ──────────────────────────────────────────────

  createPassion(data: PassionCreate): Passion {
    const count = this.storage.getPassionCount();
    if (count >= this.config.maxPassions) {
      throw new Error(`Maximum passion limit reached (${this.config.maxPassions})`);
    }
    return this.storage.createPassion(data);
  }

  getPassion(id: string): Passion | null {
    return this.storage.getPassion(id);
  }

  updatePassion(id: string, data: PassionUpdate): Passion {
    return this.storage.updatePassion(id, data);
  }

  deletePassion(id: string): boolean {
    return this.storage.deletePassion(id);
  }

  listPassions(): Passion[] {
    return this.storage.listPassions();
  }

  getActivePassions(): Passion[] {
    return this.storage.getActivePassions();
  }

  // ── Inspiration Ops ──────────────────────────────────────────

  createInspiration(data: InspirationCreate): Inspiration {
    const count = this.storage.getInspirationCount();
    if (count >= this.config.maxInspirations) {
      throw new Error(`Maximum inspiration limit reached (${this.config.maxInspirations})`);
    }
    return this.storage.createInspiration(data);
  }

  getInspiration(id: string): Inspiration | null {
    return this.storage.getInspiration(id);
  }

  updateInspiration(id: string, data: InspirationUpdate): Inspiration {
    return this.storage.updateInspiration(id, data);
  }

  deleteInspiration(id: string): boolean {
    return this.storage.deleteInspiration(id);
  }

  listInspirations(): Inspiration[] {
    return this.storage.listInspirations();
  }

  getActiveInspirations(): Inspiration[] {
    return this.storage.getActiveInspirations();
  }

  // ── Pain Ops ─────────────────────────────────────────────────

  createPain(data: PainCreate): Pain {
    const count = this.storage.getPainCount();
    if (count >= this.config.maxPains) {
      throw new Error(`Maximum pain limit reached (${this.config.maxPains})`);
    }
    return this.storage.createPain(data);
  }

  getPain(id: string): Pain | null {
    return this.storage.getPain(id);
  }

  updatePain(id: string, data: PainUpdate): Pain {
    return this.storage.updatePain(id, data);
  }

  deletePain(id: string): boolean {
    return this.storage.deletePain(id);
  }

  listPains(): Pain[] {
    return this.storage.listPains();
  }

  getActivePains(): Pain[] {
    return this.storage.getActivePains();
  }

  // ── Composition ──────────────────────────────────────────────

  composeSpiritPrompt(): string {
    if (!this.config.enabled) {
      return '';
    }

    const parts: string[] = [];

    const passions = this.storage.getActivePassions();
    if (passions.length > 0) {
      const items = passions
        .map((p) => `- **${p.name}** (intensity: ${p.intensity}): ${p.description}`)
        .join('\n');
      parts.push(`### Passions\nWhat drives me:\n${items}`);
    }

    const inspirations = this.storage.getActiveInspirations();
    if (inspirations.length > 0) {
      const items = inspirations
        .map((i) => `- **${i.source}** (impact: ${i.impact}): ${i.description}`)
        .join('\n');
      parts.push(`### Inspirations\nWhat inspires me:\n${items}`);
    }

    const pains = this.storage.getActivePains();
    if (pains.length > 0) {
      const items = pains
        .map((p) => `- **${p.trigger}** (severity: ${p.severity}): ${p.description}`)
        .join('\n');
      parts.push(`### Pain Points\nWhat causes me distress:\n${items}`);
    }

    if (parts.length === 0) {
      return '';
    }

    return '## Spirit\nYour Spirit is your drive — the emotional currents beneath your Soul. Your passions compel you, your inspirations illuminate your path, and your pains mark the boundaries you protect.\n\n' + parts.join('\n\n');
  }

  // ── Stats ────────────────────────────────────────────────────

  getStats(): SpiritStats {
    return {
      passions: {
        total: this.storage.getPassionCount(),
        active: this.storage.getActivePassions().length,
      },
      inspirations: {
        total: this.storage.getInspirationCount(),
        active: this.storage.getActiveInspirations().length,
      },
      pains: {
        total: this.storage.getPainCount(),
        active: this.storage.getActivePains().length,
      },
    };
  }

  // ── Config ───────────────────────────────────────────────────

  getConfig(): SpiritConfig {
    return this.config;
  }

  // ── Soul Access ──────────────────────────────────────────────

  getSoul(): SoulManager | null {
    return this.soul;
  }

  // ── Cleanup ──────────────────────────────────────────────────

  close(): void {
    this.storage.close();
  }
}
