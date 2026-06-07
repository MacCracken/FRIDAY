/**
 * Workflow Version Manager (Phase 114)
 *
 * Business logic for recording, tagging, comparing, and rolling back
 * workflow version snapshots.
 */

import type { WorkflowVersion, DriftSummary } from '@secureyeoman/shared';
import type { WorkflowVersionStorage } from './workflow-version-storage.js';
import type { WorkflowStorage } from './workflow-storage.js';
import { computeUnifiedDiff } from '../soul/diff-utils.js';

export interface WorkflowVersionManagerDeps {
  versionStorage: WorkflowVersionStorage;
  workflowStorage: WorkflowStorage;
}

/** Fields to track for change detection */
const TRACKED_FIELDS = [
  'name',
  'description',
  'steps',
  'edges',
  'triggers',
  'isEnabled',
  'autonomyLevel',
  'triggerMode',
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

function snapshotToText(snapshot: Record<string, unknown>): string {
  return JSON.stringify(snapshot, null, 2);
}

export class WorkflowVersionManager {
  private versionStorage: WorkflowVersionStorage;
  private workflowStorage: WorkflowStorage;

  constructor(deps: WorkflowVersionManagerDeps) {
    this.versionStorage = deps.versionStorage;
    this.workflowStorage = deps.workflowStorage;
  }

  /**
   * Record a new version snapshot of the current workflow state.
   */
  async recordVersion(workflowId: string, author?: string): Promise<WorkflowVersion> {
    const workflow = await this.workflowStorage.getDefinition(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const snapshot = structuredClone(workflow) as Record<string, unknown>;
    const snapshotText = snapshotToText(snapshot);

    // Compute diff against previous version
    const previous = await this.versionStorage.getLatestVersion(workflowId);
    let diffSummary: string | null = null;
    let changedFields: string[] = [];

    if (previous) {
      const previousText = snapshotToText(previous.snapshot);
      diffSummary = computeUnifiedDiff(previousText, snapshotText, 'previous', 'current');
      changedFields = detectChangedFields(previous.snapshot, snapshot);
    }

    return this.versionStorage.createVersion({
      workflowId,
      snapshot,
      diffSummary,
      changedFields,
      author: author ?? 'system',
    });
  }

  /**
   * Record a version and tag it as a release.
   */
  async tagRelease(
    workflowId: string,
    customTag?: string,
    author?: string
  ): Promise<WorkflowVersion> {
    const version = await this.recordVersion(workflowId, author);
    const tag = customTag ?? (await this.versionStorage.generateNextTag(workflowId));
    const tagged = await this.versionStorage.tagVersion(version.id, tag);
    return tagged ?? version;
  }

  /**
   * List versions for a workflow (paginated).
   */
  async listVersions(
    workflowId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ versions: WorkflowVersion[]; total: number }> {
    return this.versionStorage.listVersions(workflowId, opts);
  }

  /**
   * Get a specific version by ID or tag.
   */
  async getVersion(workflowId: string, idOrTag: string): Promise<WorkflowVersion | null> {
    // Try by ID first
    const byId = await this.versionStorage.getVersion(idOrTag);
    if (byId?.workflowId === workflowId) return byId;

    // Then by tag
    return this.versionStorage.getVersionByTag(workflowId, idOrTag);
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

    const textA = snapshotToText(a.snapshot);
    const textB = snapshotToText(b.snapshot);
    const labelA = a.versionTag ?? a.id.slice(0, 8);
    const labelB = b.versionTag ?? b.id.slice(0, 8);

    return computeUnifiedDiff(textA, textB, labelA, labelB);
  }

  /**
   * Rollback a workflow to a previous version's snapshot.
   */
  async rollback(
    workflowId: string,
    targetVersionId: string,
    author?: string
  ): Promise<WorkflowVersion> {
    const target = await this.versionStorage.getVersion(targetVersionId);
    if (target?.workflowId !== workflowId) {
      throw new Error(`Version not found: ${targetVersionId}`);
    }

    const snap = target.snapshot;
    const updateData: Record<string, unknown> = {};
    for (const field of TRACKED_FIELDS) {
      if (field in snap) {
        updateData[field] = snap[field];
      }
    }

    await this.workflowStorage.updateDefinition(workflowId, updateData);

    return this.recordVersion(workflowId, author ?? 'system');
  }

  /**
   * Detect drift: compare current state to last tagged release.
   */
  async getDrift(workflowId: string): Promise<DriftSummary> {
    const workflow = await this.workflowStorage.getDefinition(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const lastTagged = await this.versionStorage.getLatestTaggedVersion(workflowId);
    if (!lastTagged) {
      return {
        lastTaggedVersion: null,
        lastTaggedAt: null,
        uncommittedChanges: 0,
        changedFields: [],
        diffSummary: '',
      };
    }

    const currentSnapshot = structuredClone(workflow) as Record<string, unknown>;
    const currentText = snapshotToText(currentSnapshot);
    const taggedText = snapshotToText(lastTagged.snapshot);

    const changedFields = detectChangedFields(lastTagged.snapshot, currentSnapshot);

    const diffSummary = computeUnifiedDiff(
      taggedText,
      currentText,
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
