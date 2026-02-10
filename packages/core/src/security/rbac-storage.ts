/**
 * RBAC Storage — SQLite-backed persistent storage for role assignments.
 *
 * Prior to this module, all RBAC user-to-role mappings were held exclusively
 * in memory and lost on process restart.  This storage layer persists
 * assignments to a SQLite database following the same conventions used by
 * AuthStorage and SoulStorage:
 *
 *   - WAL journal mode for safe concurrent reads during permission checks.
 *   - Foreign-key enforcement disabled (role IDs are application-managed).
 *   - Prepared statements for all queries to avoid SQL injection.
 *   - Explicit close() for graceful shutdown integration.
 *
 * The storage manages two tables:
 *
 *   1. **role_definitions** — Custom role definitions that augment or override
 *      the hard-coded defaults in rbac.ts.  This allows operators to persist
 *      roles created via the API so they survive restarts.
 *
 *   2. **user_role_assignments** — Maps a userId to a roleId.  A user may
 *      have exactly one active assignment at a time (UNIQUE on user_id).
 *      Revoking an assignment soft-deletes the row by setting revoked_at.
 *
 * Both tables are created with IF NOT EXISTS so the storage is safe to
 * instantiate against an already-initialised database file.
 *
 * Security considerations:
 *   - All queries use parameterised statements (never string interpolation).
 *   - The revoked_at column enables auditability — we never hard-delete.
 *   - Role definitions are validated at the application layer (Zod) before
 *     being persisted; the storage layer trusts its callers.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RoleDefinition, Permission } from '@friday/shared';

// ── Row types ────────────────────────────────────────────────────────────

/**
 * Represents a persisted custom role definition as stored in SQLite.
 * Permissions and inheritFrom are serialised as JSON TEXT columns because
 * their structure is deeply nested and only needs to be queried as a whole.
 */
export interface RoleDefinitionRow {
  /** Role ID (e.g. "role_custom_ops"). Primary key. */
  id: string;
  /** Human-readable role name. */
  name: string;
  /** Optional description of the role's purpose. */
  description: string | null;
  /** JSON-serialised Permission[] array. */
  permissions_json: string;
  /** JSON-serialised string[] of parent role IDs (nullable). */
  inherit_from_json: string | null;
  /** Unix timestamp (ms) when the role was created. */
  created_at: number;
  /** Unix timestamp (ms) when the role was last modified (nullable). */
  updated_at: number | null;
}

/**
 * Represents a user-to-role assignment row in SQLite.
 *
 * The UNIQUE constraint on user_id ensures a user has at most one active
 * role.  When a role is reassigned we revoke the old row and insert a new
 * one so the audit history is preserved.
 */
export interface UserRoleAssignmentRow {
  /** Auto-incrementing primary key. */
  id: number;
  /** The user being assigned a role. */
  user_id: string;
  /** The role being assigned (references role_definitions or built-in IDs). */
  role_id: string;
  /** Who performed the assignment (admin userId or "system"). */
  assigned_by: string;
  /** Unix timestamp (ms) when the assignment was created. */
  assigned_at: number;
  /** Unix timestamp (ms) when the assignment was revoked (null = active). */
  revoked_at: number | null;
}

// ── Storage class ────────────────────────────────────────────────────────

export class RBACStorage {
  private db: Database.Database;

  /**
   * Construct a new RBACStorage instance.
   *
   * @param opts.dbPath — Path to the SQLite database file.  Defaults to
   *   ":memory:" for testing.  Parent directories are created automatically
   *   when a file path is provided.
   */
  constructor(opts: { dbPath?: string } = {}) {
    const dbPath = opts.dbPath ?? ':memory:';

    // Ensure the parent directory exists for file-backed databases.
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);

    // WAL mode gives us concurrent readers (e.g. permission checks) while
    // a single writer inserts new assignments.
    this.db.pragma('journal_mode = WAL');

    // Create both tables with IF NOT EXISTS so we're idempotent on
    // repeated startups.
    this.db.exec(`
      -- Custom role definitions that supplement the hard-coded defaults.
      -- Permissions and inheritance are stored as JSON blobs because their
      -- structure is complex and only consumed as a whole.
      CREATE TABLE IF NOT EXISTS role_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        permissions_json TEXT NOT NULL,
        inherit_from_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );

      -- User-to-role assignment table.  The UNIQUE constraint on
      -- (user_id, revoked_at) with a partial index ensures only one
      -- active (non-revoked) assignment per user.
      CREATE TABLE IF NOT EXISTS user_role_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      -- Partial unique index: at most one active assignment per user.
      -- Revoked rows (revoked_at IS NOT NULL) are excluded so historical
      -- records can coexist.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_active_role
        ON user_role_assignments (user_id)
        WHERE revoked_at IS NULL;

      -- Index for listing all assignments for a given user (audit trail).
      CREATE INDEX IF NOT EXISTS idx_user_role_user_id
        ON user_role_assignments (user_id);

      -- Index for listing all users assigned a given role.
      CREATE INDEX IF NOT EXISTS idx_user_role_role_id
        ON user_role_assignments (role_id);
    `);
  }

  // ── Role definitions ─────────────────────────────────────────────────

  /**
   * Persist a custom role definition.
   *
   * Uses INSERT OR REPLACE so that calling this with an existing role ID
   * performs an upsert — the previous row is atomically replaced.  The
   * updated_at column is set on replacements to distinguish creates from
   * updates.
   *
   * @param role — A validated RoleDefinition from the application layer.
   */
  saveRoleDefinition(role: RoleDefinition): void {
    const now = Date.now();

    // Check if the role already exists to decide created_at vs updated_at.
    const existing = this.db
      .prepare('SELECT created_at FROM role_definitions WHERE id = ?')
      .get(role.id) as { created_at: number } | undefined;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO role_definitions
           (id, name, description, permissions_json, inherit_from_json, created_at, updated_at)
         VALUES (@id, @name, @description, @permissions_json, @inherit_from_json, @created_at, @updated_at)`,
      )
      .run({
        id: role.id,
        name: role.name,
        description: role.description ?? null,
        permissions_json: JSON.stringify(role.permissions),
        inherit_from_json: role.inheritFrom ? JSON.stringify(role.inheritFrom) : null,
        created_at: existing?.created_at ?? now,
        updated_at: existing ? now : null,
      });
  }

  /**
   * Delete a custom role definition by ID.
   *
   * @returns true if a row was actually deleted, false if the ID didn't exist.
   */
  deleteRoleDefinition(roleId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM role_definitions WHERE id = ?')
      .run(roleId);
    return info.changes > 0;
  }

  /**
   * Retrieve a single custom role definition by ID.
   *
   * @returns The RoleDefinition or null if not found.
   */
  getRoleDefinition(roleId: string): RoleDefinition | null {
    const row = this.db
      .prepare('SELECT * FROM role_definitions WHERE id = ?')
      .get(roleId) as RoleDefinitionRow | undefined;

    return row ? this.rowToRoleDefinition(row) : null;
  }

  /**
   * Retrieve all persisted custom role definitions.
   *
   * These are merged with the hard-coded defaults at RBAC initialisation
   * time, with persisted roles taking precedence in case of ID collisions.
   *
   * @returns An array of RoleDefinition objects, ordered by creation time.
   */
  getAllRoleDefinitions(): RoleDefinition[] {
    const rows = this.db
      .prepare('SELECT * FROM role_definitions ORDER BY created_at ASC')
      .all() as RoleDefinitionRow[];

    return rows.map((row) => this.rowToRoleDefinition(row));
  }

  // ── User-role assignments ────────────────────────────────────────────

  /**
   * Assign a role to a user.
   *
   * If the user already has an active assignment it is automatically
   * revoked before the new one is created.  This preserves a complete
   * audit trail of role changes.
   *
   * @param userId     — The user receiving the role.
   * @param roleId     — The role to assign (must be a known role ID).
   * @param assignedBy — The admin or system identity performing the action.
   */
  assignRole(userId: string, roleId: string, assignedBy: string): void {
    const now = Date.now();

    // Wrap in a transaction so the revoke + insert is atomic.  This
    // prevents a window where a user has zero active roles.
    const txn = this.db.transaction(() => {
      // Revoke any existing active assignment for this user.
      this.db
        .prepare(
          `UPDATE user_role_assignments
             SET revoked_at = @now
           WHERE user_id = @user_id AND revoked_at IS NULL`,
        )
        .run({ now, user_id: userId });

      // Insert the new assignment.
      this.db
        .prepare(
          `INSERT INTO user_role_assignments
             (user_id, role_id, assigned_by, assigned_at, revoked_at)
           VALUES (@user_id, @role_id, @assigned_by, @assigned_at, NULL)`,
        )
        .run({
          user_id: userId,
          role_id: roleId,
          assigned_by: assignedBy,
          assigned_at: now,
        });
    });

    txn();
  }

  /**
   * Revoke the active role assignment for a user.
   *
   * Soft-deletes by setting revoked_at.  The row remains in the table
   * for audit purposes.
   *
   * @returns true if an active assignment was found and revoked.
   */
  revokeRole(userId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE user_role_assignments
           SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .run(Date.now(), userId);

    return info.changes > 0;
  }

  /**
   * Get the currently active role assignment for a user.
   *
   * @returns The role ID string, or null if the user has no active role.
   */
  getActiveRole(userId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT role_id FROM user_role_assignments
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId) as { role_id: string } | undefined;

    return row?.role_id ?? null;
  }

  /**
   * List all active user-role assignments.
   *
   * Useful for admin dashboards and for rehydrating an in-memory role
   * cache at startup.
   *
   * @returns An array of {userId, roleId} pairs for all active assignments.
   */
  listActiveAssignments(): Array<{ userId: string; roleId: string; assignedAt: number }> {
    const rows = this.db
      .prepare(
        `SELECT user_id, role_id, assigned_at
         FROM user_role_assignments
         WHERE revoked_at IS NULL
         ORDER BY assigned_at ASC`,
      )
      .all() as Array<{ user_id: string; role_id: string; assigned_at: number }>;

    return rows.map((r) => ({
      userId: r.user_id,
      roleId: r.role_id,
      assignedAt: r.assigned_at,
    }));
  }

  /**
   * Get the full assignment history for a user, including revoked entries.
   *
   * @returns All assignment rows ordered by assigned_at descending (newest first).
   */
  getAssignmentHistory(userId: string): UserRoleAssignmentRow[] {
    return this.db
      .prepare(
        `SELECT * FROM user_role_assignments
         WHERE user_id = ?
         ORDER BY assigned_at DESC`,
      )
      .all(userId) as UserRoleAssignmentRow[];
  }

  /**
   * List all users currently assigned a specific role.
   *
   * @returns An array of user IDs with that active role.
   */
  getUsersByRole(roleId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT user_id FROM user_role_assignments
         WHERE role_id = ? AND revoked_at IS NULL
         ORDER BY assigned_at ASC`,
      )
      .all(roleId) as Array<{ user_id: string }>;

    return rows.map((r) => r.user_id);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Close the underlying SQLite database connection.
   *
   * Must be called during graceful shutdown to flush WAL and release
   * the file lock.  After calling close(), any further method calls
   * will throw.
   */
  close(): void {
    this.db.close();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Convert a RoleDefinitionRow from SQLite into the application-layer
   * RoleDefinition type by deserialising the JSON columns.
   */
  private rowToRoleDefinition(row: RoleDefinitionRow): RoleDefinition {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      permissions: JSON.parse(row.permissions_json) as Permission[],
      inheritFrom: row.inherit_from_json
        ? (JSON.parse(row.inherit_from_json) as string[])
        : undefined,
    };
  }
}
