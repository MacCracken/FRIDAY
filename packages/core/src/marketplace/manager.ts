/**
 * Marketplace Manager — search, install, uninstall, publish, and community sync
 */

import fs from 'fs';
import path from 'path';
import type { CatalogSkill } from '@secureyeoman/shared';
import { SkillCreateSchema } from '@secureyeoman/shared';
import type { SecureLogger } from '../logging/logger.js';
import type { BrainManager } from '../brain/manager.js';
import type { WorkflowManager } from '../workflow/workflow-manager.js';
import type { SwarmManager } from '../agents/swarm-manager.js';
import type { CouncilManager } from '../agents/council-manager.js';
import type { SoulManager } from '../soul/manager.js';
import { MarketplaceStorage } from './storage.js';
import { gitCloneOrPull } from './git-fetch.js';
import { PersonalityMarkdownSerializer } from '../soul/personality-serializer.js';
import { errorToString, toErrorMessage } from '../utils/errors.js';

export interface MarketplaceManagerDeps {
  logger: SecureLogger;
  brainManager?: BrainManager;
  workflowManager?: WorkflowManager;
  swarmManager?: SwarmManager;
  councilManager?: CouncilManager;
  soulManager?: SoulManager;
  communityRepoPath?: string;
  allowCommunityGitFetch?: boolean;
  communityGitUrl?: string;
}

export interface CommunitySyncResult {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: string[];
  workflowsAdded: number;
  workflowsUpdated: number;
  swarmsAdded: number;
  swarmsUpdated: number;
  councilsAdded: number;
  councilsUpdated: number;
  securityTemplatesAdded: number;
  securityTemplatesUpdated: number;
  personalitiesAdded: number;
  personalitiesUpdated: number;
  themesAdded: number;
  themesUpdated: number;
}

export class MarketplaceManager {
  private storage: MarketplaceStorage;
  private logger: SecureLogger;
  private brainManager?: BrainManager;
  private workflowManager?: WorkflowManager;
  private swarmManager?: SwarmManager;
  private councilManager?: CouncilManager;
  private soulManager?: SoulManager;
  private communityRepoPath?: string;
  private allowCommunityGitFetch: boolean;
  private communityGitUrl?: string;
  private lastSyncedAt?: number;

  constructor(storage: MarketplaceStorage, deps: MarketplaceManagerDeps) {
    this.storage = storage;
    this.logger = deps.logger;
    this.brainManager = deps.brainManager;
    this.workflowManager = deps.workflowManager;
    this.swarmManager = deps.swarmManager;
    this.councilManager = deps.councilManager;
    this.soulManager = deps.soulManager;
    this.communityRepoPath = deps.communityRepoPath;
    this.allowCommunityGitFetch = deps.allowCommunityGitFetch ?? false;
    this.communityGitUrl = deps.communityGitUrl;
  }

  setDelegationManagers(managers: {
    workflowManager?: WorkflowManager;
    swarmManager?: SwarmManager;
    councilManager?: CouncilManager;
    soulManager?: SoulManager;
  }): void {
    if (managers.workflowManager) this.workflowManager = managers.workflowManager;
    if (managers.swarmManager) this.swarmManager = managers.swarmManager;
    if (managers.councilManager) this.councilManager = managers.councilManager;
    if (managers.soulManager) this.soulManager = managers.soulManager;
  }

  updatePolicy(p: { allowCommunityGitFetch?: boolean; communityGitUrl?: string }): void {
    if (p.allowCommunityGitFetch !== undefined) {
      this.allowCommunityGitFetch = p.allowCommunityGitFetch;
    }
    if (p.communityGitUrl !== undefined) {
      this.communityGitUrl = p.communityGitUrl;
    }
  }

  async search(
    query?: string,
    category?: string,
    limit?: number,
    offset?: number,
    source?: string,
    personalityId?: string
  ) {
    return await this.storage.search(query, category, limit, offset, source, personalityId);
  }

  async getSkill(id: string): Promise<CatalogSkill | null> {
    return await this.storage.getSkill(id);
  }

  async install(id: string, personalityId?: string): Promise<boolean> {
    const skill = await this.storage.getSkill(id);
    if (!skill) return false;

    if (this.brainManager) {
      const brainSource = skill.origin === 'community' ? 'community' : 'marketplace';
      const existing = await this.brainManager.listSkills({ source: brainSource });
      // Skip creating a brain skill if this exact context is already covered:
      // - personality-specific record already exists for this personality
      // - OR a global record already exists (covers all personalities)
      const alreadyCovered = existing.some(
        (s) =>
          s.name === skill.name &&
          (s.personalityId === (personalityId ?? null) || s.personalityId === null)
      );
      if (!alreadyCovered) {
        try {
          await this.brainManager.createSkill(
            SkillCreateSchema.parse({
              name: skill.name,
              description: skill.description,
              instructions: skill.instructions,
              tools: skill.tools,
              triggerPatterns: skill.triggerPatterns,
              useWhen: skill.useWhen ?? '',
              doNotUseWhen: skill.doNotUseWhen ?? '',
              successCriteria: skill.successCriteria ?? '',
              mcpToolsAllowed: skill.mcpToolsAllowed ?? [],
              routing: skill.routing ?? 'fuzzy',
              autonomyLevel: skill.autonomyLevel ?? 'L1',
              source: brainSource,
              enabled: true,
              personalityId: personalityId ?? null,
            })
          );
          this.logger.info(
            {
              id,
              name: skill.name,
              source: brainSource,
              personalityId: personalityId ?? null,
            },
            'Brain skill created from marketplace'
          );
        } catch (err) {
          this.logger.error(
            {
              id,
              error: toErrorMessage(err),
            },
            'Failed to create brain skill from marketplace'
          );
        }
      }
    }

    // Ensure the marketplace catalog flag is set
    if (!skill.installed) {
      await this.storage.setInstalled(id, true);
    }
    this.logger.info({ id, personalityId: personalityId ?? null }, 'Marketplace skill installed');
    return true;
  }

  async uninstall(id: string, personalityId?: string): Promise<boolean> {
    const skill = await this.storage.getSkill(id);
    if (!skill) return false;

    if (this.brainManager) {
      try {
        const brainSource = skill.origin === 'community' ? 'community' : 'marketplace';
        const brainSkills = await this.brainManager.listSkills({ source: brainSource });
        const matches = brainSkills.filter((s) => s.name === skill.name);

        if (personalityId !== undefined) {
          // Remove only the record for this specific personality context
          const target = matches.find((s) => s.personalityId === personalityId);
          if (target) {
            await this.brainManager.deleteSkill(target.id);
            this.logger.info(
              {
                id,
                brainSkillId: target.id,
                personalityId,
              },
              'Brain skill removed (marketplace uninstall)'
            );
          }
        } else {
          // No personality context: remove ALL brain skill records for this marketplace skill
          for (const match of matches) {
            await this.brainManager.deleteSkill(match.id);
            this.logger.info(
              {
                id,
                brainSkillId: match.id,
              },
              'Brain skill removed (marketplace uninstall)'
            );
          }
        }

        // Reset marketplace installed flag only if no brain skills remain for this skill
        const remaining = (await this.brainManager.listSkills({ source: brainSource })).filter(
          (s) => s.name === skill.name
        );
        if (remaining.length === 0) {
          await this.storage.setInstalled(id, false);
        }
      } catch (err) {
        this.logger.error(
          {
            id,
            error: toErrorMessage(err),
          },
          'Failed to remove brain skill on marketplace uninstall'
        );
        return false;
      }
    } else {
      await this.storage.setInstalled(id, false);
    }

    this.logger.info({ id, personalityId: personalityId ?? null }, 'Marketplace skill uninstalled');
    return true;
  }

  /**
   * Called when a brain skill is deleted directly (e.g. via the personality editor).
   * Resets marketplace.skills.installed if no brain skills remain for this skill.
   */
  async onBrainSkillDeleted(skillName: string, brainSource: string): Promise<void> {
    if (brainSource !== 'marketplace' && brainSource !== 'community') return;
    try {
      // If any brain skills still exist for this name+source, stay installed
      if (this.brainManager) {
        const remaining = (await this.brainManager.listSkills({ source: brainSource })).filter(
          (s) => s.name === skillName
        );
        if (remaining.length > 0) return;
      }
      // Find the marketplace record and reset installed flag
      const mpSkill =
        brainSource === 'community'
          ? await this.storage.findByNameAndSource(skillName, 'community')
          : ((await this.storage.findByNameAndSource(skillName, 'published')) ??
            (await this.storage.findByNameAndSource(skillName, 'builtin')));
      if (mpSkill?.installed) {
        await this.storage.setInstalled(mpSkill.id, false);
        this.logger.info(
          {
            name: skillName,
            marketplaceId: mpSkill.id,
          },
          'Marketplace skill marked uninstalled (brain skill deleted)'
        );
      }
    } catch (err) {
      this.logger.error(
        {
          skillName,
          error: toErrorMessage(err),
        },
        'Failed to sync marketplace installed state after brain skill deletion'
      );
    }
  }

  async publish(data: Partial<CatalogSkill>): Promise<CatalogSkill> {
    const skill = await this.storage.addSkill(data);
    this.logger.info({ id: skill.id, name: skill.name }, 'Skill published to marketplace');
    return skill;
  }

  async delete(id: string): Promise<boolean> {
    const ok = await this.storage.delete(id);
    if (ok) this.logger.info({ id }, 'Marketplace skill removed');
    return ok;
  }

  async seedBuiltinSkills(): Promise<void> {
    await this.storage.seedBuiltinSkills();
  }

  /**
   * Sync community skills from a local directory.
   * The directory should follow the structure: skills/<category>/<name>.json
   *
   * When allowCommunityGitFetch is enabled and a repoUrl is provided (or communityGitUrl
   * is configured), the repo is cloned or pulled before the local scan.
   */
  async syncFromCommunity(localPath?: string, repoUrl?: string): Promise<CommunitySyncResult> {
    const repoPath = localPath ?? this.communityRepoPath;
    const result: CommunitySyncResult = {
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      errors: [],
      workflowsAdded: 0,
      workflowsUpdated: 0,
      swarmsAdded: 0,
      swarmsUpdated: 0,
      councilsAdded: 0,
      councilsUpdated: 0,
      securityTemplatesAdded: 0,
      securityTemplatesUpdated: 0,
      personalitiesAdded: 0,
      personalitiesUpdated: 0,
      themesAdded: 0,
      themesUpdated: 0,
    };

    // Git fetch — only when policy allows and a git URL is available
    const effectiveGitUrl = repoUrl ?? this.communityGitUrl;
    if (this.allowCommunityGitFetch && effectiveGitUrl && repoPath) {
      try {
        await gitCloneOrPull(effectiveGitUrl, repoPath, this.logger);
      } catch (err) {
        result.errors.push(`Git fetch failed: ${errorToString(err)}`);
        return result;
      }
    }

    if (!repoPath) {
      result.errors.push('No community repo path configured');
      return result;
    }

    if (!fs.existsSync(repoPath)) {
      result.errors.push(`Path not found: ${repoPath}`);
      return result;
    }

    const skillsDir = path.join(repoPath, 'skills');
    if (!fs.existsSync(skillsDir)) {
      result.errors.push(`No skills/ directory found at: ${repoPath}`);
      return result;
    }

    const jsonFiles = this.findJsonFiles(skillsDir);
    const syncedNames = new Set<string>();

    for (const filePath of jsonFiles) {
      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;

        if (!data.name || typeof data.name !== 'string') {
          result.errors.push(`Skipped ${filePath}: missing required field "name"`);
          result.skipped++;
          continue;
        }

        // Parse author: string or object (backward compat)
        const rawAuthor = data.author;
        let authorDisplay = 'Community';
        let authorInfo: CatalogSkill['authorInfo'];
        if (typeof rawAuthor === 'string') {
          authorDisplay = rawAuthor;
        } else if (rawAuthor && typeof rawAuthor === 'object') {
          const a = rawAuthor as Record<string, unknown>;
          authorDisplay = typeof a.name === 'string' ? a.name : 'Community';
          authorInfo = {
            name: authorDisplay,
            github: typeof a.github === 'string' ? a.github : undefined,
            website: typeof a.website === 'string' ? a.website : undefined,
            license: typeof a.license === 'string' ? a.license : undefined,
          };
        }

        const skillData: Partial<CatalogSkill> = {
          name: data.name,
          description: typeof data.description === 'string' ? data.description : '',
          version: typeof data.version === 'string' ? data.version : '1.0.0',
          author: authorDisplay,
          authorInfo,
          category: typeof data.category === 'string' ? data.category : 'general',
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          instructions: typeof data.instructions === 'string' ? data.instructions : '',
          triggerPatterns: Array.isArray(data.triggerPatterns)
            ? (data.triggerPatterns as string[])
            : [],
          useWhen: typeof data.useWhen === 'string' ? data.useWhen : '',
          doNotUseWhen: typeof data.doNotUseWhen === 'string' ? data.doNotUseWhen : '',
          successCriteria: typeof data.successCriteria === 'string' ? data.successCriteria : '',
          mcpToolsAllowed: Array.isArray(data.mcpToolsAllowed)
            ? (data.mcpToolsAllowed as string[])
            : [],
          routing: data.routing === 'explicit' ? 'explicit' : 'fuzzy',
          autonomyLevel: (['L1', 'L2', 'L3', 'L4', 'L5'].includes(data.autonomyLevel as string)
            ? data.autonomyLevel
            : 'L1') as 'L1' | 'L2' | 'L3' | 'L4' | 'L5',
          source: 'community',
        };

        const existing = await this.storage.findByNameAndSource(skillData.name!, 'community');
        if (existing) {
          await this.storage.updateSkill(existing.id, skillData);
          result.updated++;
        } else {
          await this.storage.addSkill(skillData);
          result.added++;
        }

        syncedNames.add(data.name);
      } catch (err) {
        result.errors.push(`Error processing ${filePath}: ${errorToString(err)}`);
      }
    }

    // Prune community skills from the DB that no longer exist in the repo
    const { skills: allCommunity } = await this.storage.search(
      undefined,
      undefined,
      1000,
      0,
      'community'
    );
    for (const stale of allCommunity) {
      if (!syncedNames.has(stale.name)) {
        await this.storage.delete(stale.id);
        result.removed++;
      }
    }

    // ── Sync community workflows ────────────────────────────────────────────
    if (this.workflowManager) {
      const workflowsDir = path.join(repoPath, 'workflows');
      if (fs.existsSync(workflowsDir)) {
        const workflowFiles = this.findJsonFiles(workflowsDir);
        const syncedWorkflowNames = new Set<string>();

        // Fetch all definitions once and build lookup map to avoid N+1 queries
        const { definitions: allDefs } = await this.workflowManager.listDefinitions({
          limit: 1000,
        });
        const communityDefsByName = new Map(
          allDefs.filter((d) => (d as any).createdBy === 'community').map((d) => [d.name, d])
        );

        for (const filePath of workflowFiles) {
          try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;

            if (!data.name || typeof data.name !== 'string') {
              result.errors.push(`Skipped workflow ${filePath}: missing required field "name"`);
              result.skipped++;
              continue;
            }
            if (!Array.isArray(data.steps)) {
              result.errors.push(`Skipped workflow ${filePath}: missing required field "steps"`);
              result.skipped++;
              continue;
            }

            const workflowName = data.name;
            const existing = communityDefsByName.get(workflowName);

            if (existing) {
              await this.workflowManager.updateDefinition(existing.id, {
                description: typeof data.description === 'string' ? data.description : undefined,
                steps: data.steps as any,
                edges: Array.isArray(data.edges) ? (data.edges as any) : [],
                triggers: Array.isArray(data.triggers) ? (data.triggers as any) : [],
              });
              result.workflowsUpdated++;
            } else {
              await this.workflowManager.createDefinition({
                name: workflowName,
                description: typeof data.description === 'string' ? data.description : '',
                steps: data.steps as any,
                edges: Array.isArray(data.edges) ? (data.edges as any) : [],
                triggers: Array.isArray(data.triggers) ? (data.triggers as any) : [],
                isEnabled: true,
                version: 1,
                createdBy: 'community',
                autonomyLevel: (typeof data.autonomyLevel === 'string'
                  ? data.autonomyLevel
                  : 'L2') as any,
              });
              result.workflowsAdded++;
            }
            syncedWorkflowNames.add(workflowName);
          } catch (err) {
            result.errors.push(`Error processing workflow ${filePath}: ${errorToString(err)}`);
          }
        }

        // ── Directory-based workflow sync (Phase 113) ──────────────────────
        const workflowDirEntries = this.findDirectoryEntries(workflowsDir);
        for (const dirPath of workflowDirEntries) {
          try {
            const metadataPath = path.join(dirPath, 'metadata.json');
            const raw = await fs.promises.readFile(metadataPath, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;

            if (!data.name || typeof data.name !== 'string') {
              result.errors.push(`Skipped workflow dir ${dirPath}: missing required field "name"`);
              result.skipped++;
              continue;
            }
            if (!Array.isArray(data.steps)) {
              result.errors.push(`Skipped workflow dir ${dirPath}: missing required field "steps"`);
              result.skipped++;
              continue;
            }
            if (syncedWorkflowNames.has(data.name)) {
              this.logger.warn(
                `Skipped directory workflow "${data.name}" — already synced from JSON`
              );
              continue;
            }

            // Read README.md as description fallback
            const readmeContent = await this.readOptionalMd(path.join(dirPath, 'README.md'));
            const description =
              typeof data.description === 'string' ? data.description : (readmeContent ?? '');

            // Inject step prompts from steps/ markdown files
            const steps = await Promise.all(
              (data.steps as Record<string, unknown>[]).map(async (step) => {
                const stepId = String(step.id ?? '');
                const stepMdPath = path.join(dirPath, 'steps', `${stepId}.md`);
                const stepPrompt = await this.readOptionalMd(stepMdPath);
                if (stepPrompt !== null) {
                  const config = (step.config ?? {}) as Record<string, unknown>;
                  return { ...step, config: { ...config, prompt: stepPrompt } };
                }
                return step;
              })
            );

            const workflowName = data.name;
            const existing = communityDefsByName.get(workflowName);

            if (existing) {
              await this.workflowManager.updateDefinition(existing.id, {
                description,
                steps: steps as any,
                edges: Array.isArray(data.edges) ? (data.edges as any) : [],
                triggers: Array.isArray(data.triggers) ? (data.triggers as any) : [],
              });
              result.workflowsUpdated++;
            } else {
              await this.workflowManager.createDefinition({
                name: workflowName,
                description,
                steps: steps as any,
                edges: Array.isArray(data.edges) ? (data.edges as any) : [],
                triggers: Array.isArray(data.triggers) ? (data.triggers as any) : [],
                isEnabled: true,
                version: 1,
                createdBy: 'community',
                autonomyLevel: (typeof data.autonomyLevel === 'string'
                  ? data.autonomyLevel
                  : 'L2') as any,
              });
              result.workflowsAdded++;
            }
            syncedWorkflowNames.add(workflowName);
          } catch (err) {
            result.errors.push(`Error processing workflow dir ${dirPath}: ${errorToString(err)}`);
          }
        }

        // Prune stale community workflows
        const { definitions: pruneDefs } = await this.workflowManager.listDefinitions({
          limit: 1000,
        });
        for (const stale of pruneDefs) {
          if ((stale as any).createdBy === 'community' && !syncedWorkflowNames.has(stale.name)) {
            await this.workflowManager.deleteDefinition(stale.id);
          }
        }
      }
    }

    // ── Sync community swarm templates ──────────────────────────────────────
    if (this.swarmManager) {
      const swarmsDir = path.join(repoPath, 'swarms');
      if (fs.existsSync(swarmsDir)) {
        const swarmFiles = this.findJsonFiles(swarmsDir);
        const syncedSwarmNames = new Set<string>();

        for (const filePath of swarmFiles) {
          try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;

            if (!data.name || typeof data.name !== 'string') {
              result.errors.push(`Skipped swarm ${filePath}: missing required field "name"`);
              result.skipped++;
              continue;
            }
            if (!Array.isArray(data.roles) || (data.roles as unknown[]).length === 0) {
              result.errors.push(`Skipped swarm ${filePath}: missing required field "roles"`);
              result.skipped++;
              continue;
            }

            const swarmName = data.name;
            const roles = (data.roles as Record<string, unknown>[]).map((r) => ({
              role: String(r.role ?? ''),
              profileName: String(r.profileName ?? ''),
              description: typeof r.description === 'string' ? r.description : '',
            }));

            // Try to find existing community template by name
            const { templates } = await this.swarmManager.listTemplates({ limit: 1000 });
            const existing = templates.find((t) => t.name === swarmName && !t.isBuiltin);

            if (existing) {
              await this.swarmManager.updateTemplate(existing.id, {
                description: typeof data.description === 'string' ? data.description : undefined,
                strategy: (typeof data.strategy === 'string' ? data.strategy : 'sequential') as any,
                roles,
              });
              result.swarmsUpdated++;
            } else {
              await this.swarmManager.createTemplate({
                name: swarmName,
                description: typeof data.description === 'string' ? data.description : '',
                strategy: (typeof data.strategy === 'string' ? data.strategy : 'sequential') as any,
                roles,
                coordinatorProfile: (data.coordinatorProfile as string | null) ?? null,
              });
              result.swarmsAdded++;
            }
            syncedSwarmNames.add(swarmName);
          } catch (err) {
            result.errors.push(`Error processing swarm ${filePath}: ${errorToString(err)}`);
          }
        }

        // ── Directory-based swarm sync (Phase 113) ─────────────────────────
        const swarmDirEntries = this.findDirectoryEntries(swarmsDir);
        for (const dirPath of swarmDirEntries) {
          try {
            const metadataPath = path.join(dirPath, 'metadata.json');
            const raw = await fs.promises.readFile(metadataPath, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;

            if (!data.name || typeof data.name !== 'string') {
              result.errors.push(`Skipped swarm dir ${dirPath}: missing required field "name"`);
              result.skipped++;
              continue;
            }
            if (!Array.isArray(data.roles) || (data.roles as unknown[]).length === 0) {
              result.errors.push(`Skipped swarm dir ${dirPath}: missing required field "roles"`);
              result.skipped++;
              continue;
            }
            if (syncedSwarmNames.has(data.name)) {
              this.logger.warn(`Skipped directory swarm "${data.name}" — already synced from JSON`);
              continue;
            }

            // Read README.md as description fallback
            const readmeContent = await this.readOptionalMd(path.join(dirPath, 'README.md'));
            const description =
              typeof data.description === 'string' ? data.description : (readmeContent ?? '');

            // Inject role prompts from roles/ markdown files
            const swarmName = data.name;
            const roles = await Promise.all(
              (data.roles as Record<string, unknown>[]).map(async (r) => {
                const roleName = String(r.role ?? '');
                const roleMdPath = path.join(dirPath, 'roles', `${roleName}.md`);
                const rolePrompt = await this.readOptionalMd(roleMdPath);
                return {
                  role: roleName,
                  profileName: String(r.profileName ?? ''),
                  description: typeof r.description === 'string' ? r.description : '',
                  ...(rolePrompt !== null ? { systemPromptOverride: rolePrompt } : {}),
                };
              })
            );

            const { templates } = await this.swarmManager.listTemplates({ limit: 1000 });
            const existing = templates.find((t) => t.name === swarmName && !t.isBuiltin);

            if (existing) {
              await this.swarmManager.updateTemplate(existing.id, {
                description,
                strategy: (typeof data.strategy === 'string' ? data.strategy : 'sequential') as any,
                roles,
              });
              result.swarmsUpdated++;
            } else {
              await this.swarmManager.createTemplate({
                name: swarmName,
                description,
                strategy: (typeof data.strategy === 'string' ? data.strategy : 'sequential') as any,
                roles,
                coordinatorProfile: (data.coordinatorProfile as string | null) ?? null,
              });
              result.swarmsAdded++;
            }
            syncedSwarmNames.add(swarmName);
          } catch (err) {
            result.errors.push(`Error processing swarm dir ${dirPath}: ${errorToString(err)}`);
          }
        }
      }
    }

    // ── Sync community council templates ──────────────────────────────────
    if (this.councilManager) {
      const councilsDir = path.join(repoPath, 'councils');
      if (fs.existsSync(councilsDir)) {
        const councilFiles = this.findJsonFiles(councilsDir);
        const syncedCouncilNames = new Set<string>();

        for (const filePath of councilFiles) {
          try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;

            if (!data.name || typeof data.name !== 'string') {
              result.errors.push(`Skipped council ${filePath}: missing required field "name"`);
              result.skipped++;
              continue;
            }
            if (!Array.isArray(data.members) || (data.members as unknown[]).length === 0) {
              result.errors.push(`Skipped council ${filePath}: missing required field "members"`);
              result.skipped++;
              continue;
            }
            if (!data.facilitatorProfile || typeof data.facilitatorProfile !== 'string') {
              result.errors.push(
                `Skipped council ${filePath}: missing required field "facilitatorProfile"`
              );
              result.skipped++;
              continue;
            }

            const councilName = data.name;
            const members = (data.members as Record<string, unknown>[]).map((m) => ({
              role: String(m.role ?? ''),
              profileName: String(m.profileName ?? ''),
              description: typeof m.description === 'string' ? m.description : '',
              weight: typeof m.weight === 'number' ? m.weight : 1,
              perspective: typeof m.perspective === 'string' ? m.perspective : undefined,
            }));

            const { templates } = await this.councilManager.listTemplates({ limit: 1000 });
            const existing = templates.find((t) => t.name === councilName && !t.isBuiltin);

            if (existing) {
              await this.councilManager.updateTemplate(existing.id, {
                description: typeof data.description === 'string' ? data.description : undefined,
                members,
                facilitatorProfile: data.facilitatorProfile,
                deliberationStrategy: (typeof data.deliberationStrategy === 'string'
                  ? data.deliberationStrategy
                  : 'rounds') as any,
                maxRounds: typeof data.maxRounds === 'number' ? data.maxRounds : 3,
                votingStrategy: (typeof data.votingStrategy === 'string'
                  ? data.votingStrategy
                  : 'facilitator_judgment') as any,
              });
              result.councilsUpdated++;
            } else {
              await this.councilManager.createTemplate({
                name: councilName,
                description: typeof data.description === 'string' ? data.description : '',
                members,
                facilitatorProfile: data.facilitatorProfile,
                deliberationStrategy: (typeof data.deliberationStrategy === 'string'
                  ? data.deliberationStrategy
                  : 'rounds') as any,
                maxRounds: typeof data.maxRounds === 'number' ? data.maxRounds : 3,
                votingStrategy: (typeof data.votingStrategy === 'string'
                  ? data.votingStrategy
                  : 'facilitator_judgment') as any,
              });
              result.councilsAdded++;
            }
            syncedCouncilNames.add(councilName);
          } catch (err) {
            result.errors.push(`Error processing council ${filePath}: ${errorToString(err)}`);
          }
        }
      }
    }

    // ── Sync community security templates ──────────────────────────────────
    const securityTemplatesDir = path.join(repoPath, 'security-templates');
    if (fs.existsSync(securityTemplatesDir)) {
      try {
        const templateDirs = fs
          .readdirSync(securityTemplatesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory());

        for (const dir of templateDirs) {
          const templatePath = path.join(securityTemplatesDir, dir.name);
          const metadataPath = path.join(templatePath, 'metadata.json');

          if (!fs.existsSync(metadataPath)) {
            result.errors.push(`Skipped security template ${dir.name}: missing metadata.json`);
            result.skipped++;
            continue;
          }

          try {
            const metadata = JSON.parse(
              await fs.promises.readFile(metadataPath, 'utf-8')
            ) as Record<string, unknown>;

            if (!metadata.name || typeof metadata.name !== 'string') {
              result.errors.push(
                `Skipped security template ${dir.name}: metadata.json missing "name"`
              );
              result.skipped++;
              continue;
            }

            // Resolve filenames — metadata.files overrides defaults
            const files = metadata.files as Record<string, unknown> | undefined;
            const systemFile =
              files && typeof files.system === 'string' ? files.system : 'system.md';
            const userFile = files && typeof files.user === 'string' ? files.user : 'user.md';

            const systemPath = path.join(templatePath, systemFile);
            const userPath = path.join(templatePath, userFile);

            if (!fs.existsSync(systemPath)) {
              result.errors.push(`Skipped security template ${dir.name}: missing ${systemFile}`);
              result.skipped++;
              continue;
            }

            const systemContent = await fs.promises.readFile(systemPath, 'utf-8');
            let instructions = systemContent;

            if (fs.existsSync(userPath)) {
              const userContent = await fs.promises.readFile(userPath, 'utf-8');
              instructions += '\n\n## User Input Template\n\n' + userContent;
            }

            // Parse author
            const rawAuthor = metadata.author;
            let authorDisplay = 'Community';
            let authorInfo: CatalogSkill['authorInfo'];
            if (typeof rawAuthor === 'string') {
              authorDisplay = rawAuthor;
            } else if (rawAuthor && typeof rawAuthor === 'object') {
              const a = rawAuthor as Record<string, unknown>;
              authorDisplay = typeof a.name === 'string' ? a.name : 'Community';
              authorInfo = {
                name: authorDisplay,
                github: typeof a.github === 'string' ? a.github : undefined,
                website: typeof a.website === 'string' ? a.website : undefined,
                license: typeof a.license === 'string' ? a.license : undefined,
              };
            }

            const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : [];
            if (!tags.includes('security-template')) {
              tags.push('security-template');
            }

            const skillData: Partial<CatalogSkill> = {
              name: metadata.name,
              description: typeof metadata.description === 'string' ? metadata.description : '',
              version: typeof metadata.version === 'string' ? metadata.version : '1.0.0',
              author: authorDisplay,
              authorInfo,
              category: 'security',
              tags,
              instructions,
              triggerPatterns: [],
              useWhen: '',
              doNotUseWhen: '',
              successCriteria: '',
              mcpToolsAllowed: [],
              routing: 'fuzzy',
              autonomyLevel: (['L1', 'L2', 'L3', 'L4', 'L5'].includes(
                metadata.autonomyLevel as string
              )
                ? metadata.autonomyLevel
                : 'L1') as 'L1' | 'L2' | 'L3' | 'L4' | 'L5',
              source: 'community',
            };

            const existing = await this.storage.findByNameAndSource(skillData.name!, 'community');
            if (existing) {
              await this.storage.updateSkill(existing.id, skillData);
              result.securityTemplatesUpdated++;
            } else {
              await this.storage.addSkill(skillData);
              result.securityTemplatesAdded++;
            }

            // Track for prune protection
            syncedNames.add(metadata.name);
          } catch (err) {
            result.errors.push(
              `Error processing security template ${dir.name}: ${errorToString(err)}`
            );
          }
        }
      } catch {
        // Non-readable directory — skip silently
      }
    }

    // ── Sync community personalities (catalog only — user must install manually) ─
    {
      const personalitiesDir = path.join(repoPath, 'personalities');
      if (fs.existsSync(personalitiesDir)) {
        const serializer = new PersonalityMarkdownSerializer();
        const mdFiles = this.findMdFiles(personalitiesDir);

        for (const filePath of mdFiles) {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const { data, warnings } = serializer.fromMarkdown(content);

            if (warnings.length > 0) {
              this.logger.debug(
                {
                  file: filePath,
                  warnings,
                },
                'Community personality parse warnings'
              );
            }

            // Extract subdirectory as a subcategory tag (e.g., "professional", "sci-fi")
            const relPath = path.relative(personalitiesDir, filePath);
            const subDir = path.dirname(relPath);
            const tags = ['personality', 'community-personality'];
            if (subDir && subDir !== '.') {
              // Use full subdirectory path as subcategory tag (e.g., "sci-fi/antagonist")
              const subCategory = subDir.split(path.sep).join('/');
              tags.push(`personality:${subCategory}`);
            }
            const skillData: Partial<CatalogSkill> = {
              name: data.name ?? path.basename(filePath, '.md'),
              description: data.description ?? '',
              version: '1.0.0',
              author:
                typeof (data as Record<string, unknown>).author === 'string'
                  ? ((data as Record<string, unknown>).author as string)
                  : typeof (data as Record<string, unknown>).author === 'object' &&
                      (data as Record<string, unknown>).author !== null
                    ? ((((data as Record<string, unknown>).author as Record<string, unknown>)
                        .name as string) ?? 'Community')
                    : 'Community',
              category: 'personality',
              tags,
              instructions: content,
              triggerPatterns: [],
              useWhen: '',
              doNotUseWhen: '',
              successCriteria: '',
              mcpToolsAllowed: [],
              routing: 'fuzzy',
              autonomyLevel: 'L1',
              source: 'community',
            };

            const existing = await this.storage.findByNameAndSource(skillData.name!, 'community');
            if (existing?.tags?.includes('community-personality')) {
              await this.storage.updateSkill(existing.id, skillData);
              result.personalitiesUpdated++;
            } else if (!existing) {
              await this.storage.addSkill(skillData);
              result.personalitiesAdded++;
            } else {
              result.skipped++;
            }

            syncedNames.add(skillData.name!);
          } catch (err) {
            result.errors.push(`Error processing personality ${filePath}: ${errorToString(err)}`);
          }
        }
      }
    }

    // ── Sync community themes ────────────────────────────────────────────
    const themesDir = path.join(repoPath, 'themes');
    if (fs.existsSync(themesDir)) {
      const themeFiles = this.findJsonFiles(themesDir);

      for (const filePath of themeFiles) {
        try {
          const raw = await fs.promises.readFile(filePath, 'utf-8');
          const data = JSON.parse(raw) as Record<string, unknown>;

          if (!data.name || typeof data.name !== 'string') {
            result.errors.push(`Skipped theme ${filePath}: missing required field "name"`);
            result.skipped++;
            continue;
          }
          if (!data.variables || typeof data.variables !== 'object') {
            result.errors.push(`Skipped theme ${filePath}: missing required field "variables"`);
            result.skipped++;
            continue;
          }

          const tags = ['theme', 'community-theme'];
          if (typeof data.isDark === 'boolean') {
            tags.push(data.isDark ? 'dark' : 'light');
          }
          // Add subdirectory as subcategory tag (e.g., "theme:dark", "theme:light")
          const relPath = path.relative(themesDir, filePath);
          const subDir = path.dirname(relPath);
          if (subDir && subDir !== '.') {
            const subCategory = subDir.split(path.sep).join('/');
            tags.push(`theme:${subCategory}`);
          }

          const skillData: Partial<CatalogSkill> = {
            name: data.name,
            description: typeof data.description === 'string' ? data.description : '',
            version: typeof data.version === 'string' ? data.version : '1.0.0',
            author:
              typeof data.author === 'string'
                ? data.author
                : typeof data.author === 'object' && data.author !== null
                  ? (((data.author as Record<string, unknown>).name as string) ?? 'Community')
                  : 'Community',
            category: 'theme',
            tags,
            instructions: JSON.stringify(data),
            triggerPatterns: [],
            useWhen: '',
            doNotUseWhen: '',
            successCriteria: '',
            mcpToolsAllowed: [],
            routing: 'fuzzy',
            autonomyLevel: 'L1',
            source: 'community',
          };

          const existing = await this.storage.findByNameAndSource(skillData.name!, 'community');
          if (existing) {
            await this.storage.updateSkill(existing.id, skillData);
            result.themesUpdated++;
          } else {
            await this.storage.addSkill(skillData);
            result.themesAdded++;
          }

          // Track for prune protection
          syncedNames.add(data.name);
        } catch (err) {
          result.errors.push(`Error processing theme ${filePath}: ${errorToString(err)}`);
        }
      }
    }

    this.lastSyncedAt = Date.now();
    this.logger.info(
      {
        path: repoPath,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
        workflowsAdded: result.workflowsAdded,
        workflowsUpdated: result.workflowsUpdated,
        swarmsAdded: result.swarmsAdded,
        swarmsUpdated: result.swarmsUpdated,
        councilsAdded: result.councilsAdded,
        councilsUpdated: result.councilsUpdated,
        securityTemplatesAdded: result.securityTemplatesAdded,
        securityTemplatesUpdated: result.securityTemplatesUpdated,
        personalitiesAdded: result.personalitiesAdded,
        personalitiesUpdated: result.personalitiesUpdated,
        themesAdded: result.themesAdded,
        themesUpdated: result.themesUpdated,
      },
      'Community skill sync complete'
    );

    return result;
  }

  /**
   * Returns status information about the community repo configuration.
   */
  async getCommunityStatus(): Promise<{
    communityRepoPath: string | null;
    skillCount: number;
    lastSyncedAt: number | null;
  }> {
    const { total } = await this.storage.search(undefined, undefined, 1, 0, 'community');
    return {
      communityRepoPath: this.communityRepoPath ?? null,
      skillCount: total,
      lastSyncedAt: this.lastSyncedAt ?? null,
    };
  }

  private findJsonFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip directories that contain metadata.json — those are directory-based entries
          const metadataPath = path.join(fullPath, 'metadata.json');
          if (!fs.existsSync(metadataPath)) {
            results.push(...this.findJsonFiles(fullPath));
          }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
    } catch {
      // Non-readable directory — skip silently
    }
    return results;
  }

  private findMdFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findMdFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch {
      // Non-readable directory — skip silently
    }
    return results;
  }

  /**
   * Find subdirectories containing metadata.json (directory-based entries).
   */
  findDirectoryEntries(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const metadataPath = path.join(dir, entry.name, 'metadata.json');
          if (fs.existsSync(metadataPath)) {
            results.push(path.join(dir, entry.name));
          }
        }
      }
    } catch {
      // Non-readable directory — skip silently
    }
    return results;
  }

  /**
   * Read a markdown file, returning its content or null if it doesn't exist.
   */
  async readOptionalMd(filePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
