/**
 * Personality Version Manager (Phase 114)
 *
 * Business logic for recording, tagging, comparing, and rolling back
 * personality version snapshots.
 */

import type { PersonalityVersion, DriftSummary } from '@secureyeoman/shared';
import type { PersonalityVersionStorage } from './personality-version-storage.js';
import type { SoulStorage } from './storage.js';
import type { PersonalityMarkdownSerializer } from './personality-serializer.js';
import { computeUnifiedDiff } from './diff-utils.js';

export interface PersonalityVersionManagerDeps {
  versionStorage: PersonalityVersionStorage;
  soulStorage: SoulStorage;
  serializer: PersonalityMarkdownSerializer;
}

/** Fields to track for change detection */
const TRACKED_FIELDS = [
  'name',
  'description',
  'systemPrompt',
  'traits',
  'sex',
  'voice',
  'preferredLanguage',
  'defaultModel',
  'modelFallbacks',
  'includeArchetypes',
  'injectDateTime',
  'empathyResonance',
  'avatarUrl',
  'body',
  'brainConfig',
] as const;

function detectChangedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const field of TRACKED_FIELDS) {
    const va = JSON.stringify(a[field] ?? null);
    const vb = JSON.stringify(b[field] ?? null);
    if (va !== vb) changed.push(field);
  }
  return changed;
}

export class PersonalityVersionManager {
  private versionStorage: PersonalityVersionStorage;
  private soulStorage: SoulStorage;
  private serializer: PersonalityMarkdownSerializer;

  constructor(deps: PersonalityVersionManagerDeps) {
    this.versionStorage = deps.versionStorage;
    this.soulStorage = deps.soulStorage;
    this.serializer = deps.serializer;
  }

  /**
   * Record a new version snapshot of the current personality state.
   */
  async recordVersion(personalityId: string, author?: string): Promise<PersonalityVersion> {
    const personality = await this.soulStorage.getPersonality(personalityId);
    if (!personality) {
      throw new Error(`Personality not found: ${personalityId}`);
    }

    const snapshotMd = this.serializer.toMarkdown(personality);
    const snapshot = structuredClone(personality) as Record<string, unknown>;

    // Compute diff against previous version
    const previous = await this.versionStorage.getLatestVersion(personalityId);
    let diffSummary: string | null = null;
    let changedFields: string[] = [];

    if (previous) {
      const previousMd = previous.snapshotMd;
      diffSummary = computeUnifiedDiff(previousMd, snapshotMd, 'previous', 'current');
      changedFields = detectChangedFields(previous.snapshot, snapshot);
    }

    return this.versionStorage.createVersion({
      personalityId,
      snapshot,
      snapshotMd,
      diffSummary,
      changedFields,
      author: author ?? 'system',
    });
  }

  /**
   * Record a version and tag it as a release.
   */
  async tagRelease(
    personalityId: string,
    customTag?: string,
    author?: string
  ): Promise<PersonalityVersion> {
    const version = await this.recordVersion(personalityId, author);
    const tag = customTag ?? (await this.versionStorage.generateNextTag(personalityId));
    const tagged = await this.versionStorage.tagVersion(version.id, tag);
    return tagged ?? version;
  }

  /**
   * List versions for a personality (paginated).
   */
  async listVersions(
    personalityId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ versions: PersonalityVersion[]; total: number }> {
    return this.versionStorage.listVersions(personalityId, opts);
  }

  /**
   * Get a specific version by ID or tag.
   */
  async getVersion(personalityId: string, idOrTag: string): Promise<PersonalityVersion | null> {
    // Try by ID first
    const byId = await this.versionStorage.getVersion(idOrTag);
    if (byId?.personalityId === personalityId) return byId;

    // Then by tag
    return this.versionStorage.getVersionByTag(personalityId, idOrTag);
  }

  /**
   * Remove a tag from a version.
   */
  async clearTag(versionId: string): Promise<PersonalityVersion | null> {
    return this.versionStorage.clearTag(versionId);
  }

  /**
   * Compute unified diff between two versions.
   */
  async diffVersions(versionIdA: string, versionIdB: string): Promise<string> {
    const [a, b] = await Promise.all([
      this.versionStorage.getVersion(versionIdA),
      this.versionStorage.getVersion(versionIdB),
    ]);
    if (!a) throw new Error(`Version not found: ${versionIdA}`);
    if (!b) throw new Error(`Version not found: ${versionIdB}`);

    const mdA = a.snapshotMd;
    const mdB = b.snapshotMd;
    const labelA = a.versionTag ?? a.id.slice(0, 8);
    const labelB = b.versionTag ?? b.id.slice(0, 8);

    return computeUnifiedDiff(mdA, mdB, labelA, labelB);
  }

  /**
   * Rollback a personality to a previous version's snapshot.
   */
  async rollback(
    personalityId: string,
    targetVersionId: string,
    author?: string
  ): Promise<PersonalityVersion> {
    const target = await this.versionStorage.getVersion(targetVersionId);
    if (target?.personalityId !== personalityId) {
      throw new Error(`Version not found: ${targetVersionId}`);
    }

    // Extract the personality fields from snapshot and apply to current personality
    const snap = target.snapshot;
    const updateData: Record<string, unknown> = {};
    for (const field of TRACKED_FIELDS) {
      if (field in snap) {
        updateData[field] = snap[field];
      }
    }

    await this.soulStorage.updatePersonality(personalityId, updateData);

    // Record a new version after rollback
    return this.recordVersion(personalityId, author ?? 'system');
  }

  /**
   * Detect drift: compare current state to last tagged release.
   */
  async getDrift(personalityId: string): Promise<DriftSummary> {
    const personality = await this.soulStorage.getPersonality(personalityId);
    if (!personality) {
      throw new Error(`Personality not found: ${personalityId}`);
    }

    const lastTagged = await this.versionStorage.getLatestTaggedVersion(personalityId);
    if (!lastTagged) {
      return {
        lastTaggedVersion: null,
        lastTaggedAt: null,
        uncommittedChanges: 0,
        changedFields: [],
        diffSummary: '',
      };
    }

    const currentMd = this.serializer.toMarkdown(personality);
    const currentSnapshot = structuredClone(personality) as Record<string, unknown>;

    const changedFields = detectChangedFields(lastTagged.snapshot, currentSnapshot);

    const diffSummary = computeUnifiedDiff(
      lastTagged.snapshotMd,
      currentMd,
      lastTagged.versionTag ?? 'tagged',
      'current'
    );

    return {
      lastTaggedVersion: lastTagged.versionTag,
      lastTaggedAt: lastTagged.createdAt,
      uncommittedChanges: changedFields.length,
      changedFields,
      diffSummary,
    };
  }
}
