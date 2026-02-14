/**
 * Marketplace Manager — search, install, uninstall, publish skills
 */

import type { MarketplaceSkill } from '@friday/shared';
import type { SecureLogger } from '../logging/logger.js';
import type { BrainManager } from '../brain/manager.js';
import { MarketplaceStorage } from './storage.js';

export interface MarketplaceManagerDeps {
  logger: SecureLogger;
  brainManager?: BrainManager;
}

export class MarketplaceManager {
  private storage: MarketplaceStorage;
  private logger: SecureLogger;
  private brainManager?: BrainManager;

  constructor(storage: MarketplaceStorage, deps: MarketplaceManagerDeps) {
    this.storage = storage;
    this.logger = deps.logger;
    this.brainManager = deps.brainManager;
  }

  search(query?: string, category?: string, limit?: number, offset?: number) {
    return this.storage.search(query, category, limit, offset);
  }

  getSkill(id: string): MarketplaceSkill | null { return this.storage.getSkill(id); }

  install(id: string): boolean {
    const skill = this.storage.getSkill(id);
    if (!skill) return false;
    if (skill.installed) return true;
    const ok = this.storage.setInstalled(id, true);
    if (ok) {
      this.logger.info('Marketplace skill installed', { id });
      if (this.brainManager) {
        try {
          this.brainManager.createSkill({
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            tools: skill.tools,
            source: 'marketplace',
            enabled: true,
          });
          this.logger.info('Brain skill created from marketplace', { id, name: skill.name });
        } catch (err) {
          this.logger.error('Failed to create brain skill from marketplace', {
            id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }
    return ok;
  }

  uninstall(id: string): boolean {
    const skill = this.storage.getSkill(id);
    const ok = this.storage.setInstalled(id, false);
    if (ok) {
      this.logger.info('Marketplace skill uninstalled', { id });
      if (this.brainManager && skill) {
        try {
          const brainSkills = this.brainManager.listSkills({ source: 'marketplace' });
          const match = brainSkills.find(s => s.name === skill.name);
          if (match) {
            this.brainManager.deleteSkill(match.id);
            this.logger.info('Brain skill removed (marketplace uninstall)', { id, brainSkillId: match.id });
          }
        } catch (err) {
          this.logger.error('Failed to remove brain skill on marketplace uninstall', {
            id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }
    return ok;
  }

  publish(data: Partial<MarketplaceSkill>): MarketplaceSkill {
    const skill = this.storage.addSkill(data);
    this.logger.info('Skill published to marketplace', { id: skill.id, name: skill.name });
    return skill;
  }

  delete(id: string): boolean {
    const ok = this.storage.delete(id);
    if (ok) this.logger.info('Marketplace skill removed', { id });
    return ok;
  }

  seedBuiltinSkills(): void {
    this.storage.seedBuiltinSkills();
  }
}
