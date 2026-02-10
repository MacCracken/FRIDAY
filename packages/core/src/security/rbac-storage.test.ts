/**
 * Tests for RBACStorage — SQLite-backed persistent storage for role
 * definitions and user-role assignments.
 *
 * These tests verify:
 *   - Role definition CRUD (create, read, update, delete)
 *   - User-role assignment lifecycle (assign, revoke, reassign)
 *   - Constraint enforcement (one active role per user)
 *   - Audit trail preservation (revoked assignments remain queryable)
 *   - Edge cases (unknown roles, double revokes, empty state)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RBACStorage } from './rbac-storage.js';
import type { RoleDefinition } from '@friday/shared';

describe('RBACStorage', () => {
  let storage: RBACStorage;

  beforeEach(() => {
    // Use in-memory SQLite for test isolation — no disk I/O.
    storage = new RBACStorage({ dbPath: ':memory:' });
  });

  afterEach(() => {
    storage.close();
  });

  // ── Role definitions ─────────────────────────────────────────────────

  describe('Role definitions', () => {
    const testRole: RoleDefinition = {
      id: 'role_test',
      name: 'Test Role',
      description: 'A role for testing',
      permissions: [
        { resource: 'tests', actions: ['read', 'write'] },
        { resource: 'metrics', actions: ['read'] },
      ],
    };

    it('should save and retrieve a role definition', () => {
      storage.saveRoleDefinition(testRole);

      const retrieved = storage.getRoleDefinition('role_test');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('role_test');
      expect(retrieved!.name).toBe('Test Role');
      expect(retrieved!.description).toBe('A role for testing');
      expect(retrieved!.permissions).toHaveLength(2);
      expect(retrieved!.permissions[0]).toEqual({
        resource: 'tests',
        actions: ['read', 'write'],
      });
    });

    it('should return null for non-existent role', () => {
      const result = storage.getRoleDefinition('role_nonexistent');
      expect(result).toBeNull();
    });

    it('should upsert when saving an existing role', () => {
      storage.saveRoleDefinition(testRole);

      // Update the role
      const updatedRole: RoleDefinition = {
        ...testRole,
        name: 'Updated Test Role',
        permissions: [{ resource: 'everything', actions: ['*'] }],
      };
      storage.saveRoleDefinition(updatedRole);

      const retrieved = storage.getRoleDefinition('role_test');
      expect(retrieved!.name).toBe('Updated Test Role');
      expect(retrieved!.permissions).toHaveLength(1);
      expect(retrieved!.permissions[0].resource).toBe('everything');
    });

    it('should save roles with inheritance', () => {
      const childRole: RoleDefinition = {
        id: 'role_child',
        name: 'Child Role',
        permissions: [{ resource: 'child', actions: ['read'] }],
        inheritFrom: ['role_test', 'role_admin'],
      };

      storage.saveRoleDefinition(childRole);

      const retrieved = storage.getRoleDefinition('role_child');
      expect(retrieved!.inheritFrom).toEqual(['role_test', 'role_admin']);
    });

    it('should handle roles without optional fields', () => {
      const minimalRole: RoleDefinition = {
        id: 'role_minimal',
        name: 'Minimal',
        permissions: [],
      };

      storage.saveRoleDefinition(minimalRole);

      const retrieved = storage.getRoleDefinition('role_minimal');
      expect(retrieved!.description).toBeUndefined();
      expect(retrieved!.inheritFrom).toBeUndefined();
    });

    it('should delete a role definition', () => {
      storage.saveRoleDefinition(testRole);

      const deleted = storage.deleteRoleDefinition('role_test');
      expect(deleted).toBe(true);

      const retrieved = storage.getRoleDefinition('role_test');
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent role', () => {
      const deleted = storage.deleteRoleDefinition('role_nonexistent');
      expect(deleted).toBe(false);
    });

    it('should list all role definitions ordered by creation time', () => {
      const role1: RoleDefinition = {
        id: 'role_first',
        name: 'First',
        permissions: [],
      };
      const role2: RoleDefinition = {
        id: 'role_second',
        name: 'Second',
        permissions: [{ resource: 'data', actions: ['read'] }],
      };

      storage.saveRoleDefinition(role1);
      storage.saveRoleDefinition(role2);

      const all = storage.getAllRoleDefinitions();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe('role_first');
      expect(all[1].id).toBe('role_second');
    });

    it('should return empty array when no roles are defined', () => {
      const all = storage.getAllRoleDefinitions();
      expect(all).toEqual([]);
    });
  });

  // ── User-role assignments ────────────────────────────────────────────

  describe('User-role assignments', () => {
    it('should assign a role to a user', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');

      const role = storage.getActiveRole('user_1');
      expect(role).toBe('role_operator');
    });

    it('should return null for user with no assignment', () => {
      const role = storage.getActiveRole('user_unknown');
      expect(role).toBeNull();
    });

    it('should automatically revoke old role when reassigning', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');
      storage.assignRole('user_1', 'role_admin', 'admin');

      // Active role should be the new one
      const role = storage.getActiveRole('user_1');
      expect(role).toBe('role_admin');

      // History should show both assignments
      const history = storage.getAssignmentHistory('user_1');
      expect(history).toHaveLength(2);

      // Find the active and revoked entries regardless of ordering
      // (timestamps may collide in fast tests)
      const active = history.find((h) => h.revoked_at === null);
      const revoked = history.find((h) => h.revoked_at !== null);

      expect(active).toBeDefined();
      expect(active!.role_id).toBe('role_admin');

      expect(revoked).toBeDefined();
      expect(revoked!.role_id).toBe('role_operator');
    });

    it('should revoke a role assignment', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');

      const revoked = storage.revokeRole('user_1');
      expect(revoked).toBe(true);

      const role = storage.getActiveRole('user_1');
      expect(role).toBeNull();
    });

    it('should return false when revoking non-existent assignment', () => {
      const revoked = storage.revokeRole('user_nonexistent');
      expect(revoked).toBe(false);
    });

    it('should return false when revoking already-revoked assignment', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');
      storage.revokeRole('user_1');

      const secondRevoke = storage.revokeRole('user_1');
      expect(secondRevoke).toBe(false);
    });

    it('should list all active assignments', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');
      storage.assignRole('user_2', 'role_viewer', 'admin');
      storage.assignRole('user_3', 'role_auditor', 'admin');

      // Revoke one
      storage.revokeRole('user_2');

      const active = storage.listActiveAssignments();
      expect(active).toHaveLength(2);

      const userIds = active.map((a) => a.userId);
      expect(userIds).toContain('user_1');
      expect(userIds).toContain('user_3');
      expect(userIds).not.toContain('user_2');
    });

    it('should return empty array when no active assignments exist', () => {
      const active = storage.listActiveAssignments();
      expect(active).toEqual([]);
    });

    it('should list users by role', () => {
      storage.assignRole('user_1', 'role_operator', 'admin');
      storage.assignRole('user_2', 'role_operator', 'admin');
      storage.assignRole('user_3', 'role_viewer', 'admin');

      const operators = storage.getUsersByRole('role_operator');
      expect(operators).toHaveLength(2);
      expect(operators).toContain('user_1');
      expect(operators).toContain('user_2');

      const viewers = storage.getUsersByRole('role_viewer');
      expect(viewers).toHaveLength(1);
      expect(viewers).toContain('user_3');
    });

    it('should return empty array for role with no users', () => {
      const users = storage.getUsersByRole('role_nonexistent');
      expect(users).toEqual([]);
    });

    it('should preserve assignment history after multiple changes', () => {
      storage.assignRole('user_1', 'role_viewer', 'admin');
      storage.assignRole('user_1', 'role_operator', 'admin');
      storage.assignRole('user_1', 'role_admin', 'system');

      const history = storage.getAssignmentHistory('user_1');
      expect(history).toHaveLength(3);

      // Only the latest should be active
      const activeEntries = history.filter((h) => h.revoked_at === null);
      expect(activeEntries).toHaveLength(1);
      expect(activeEntries[0].role_id).toBe('role_admin');
      expect(activeEntries[0].assigned_by).toBe('system');

      // The other two should be revoked
      const revokedEntries = history.filter((h) => h.revoked_at !== null);
      expect(revokedEntries).toHaveLength(2);
      const revokedRoles = revokedEntries.map((h) => h.role_id).sort();
      expect(revokedRoles).toEqual(['role_operator', 'role_viewer']);
    });

    it('should track assignedBy for audit trail', () => {
      storage.assignRole('user_1', 'role_operator', 'admin_alice');

      const history = storage.getAssignmentHistory('user_1');
      expect(history[0].assigned_by).toBe('admin_alice');
    });

    it('should include assignedAt in active assignments listing', () => {
      const before = Date.now();
      storage.assignRole('user_1', 'role_operator', 'admin');
      const after = Date.now();

      const active = storage.listActiveAssignments();
      expect(active).toHaveLength(1);
      expect(active[0].assignedAt).toBeGreaterThanOrEqual(before);
      expect(active[0].assignedAt).toBeLessThanOrEqual(after);
    });
  });

  // ── Integration: RBAC with storage ───────────────────────────────────

  describe('Integration with RBAC class', () => {
    it('should load persisted roles into RBAC on construction', async () => {
      // Dynamically import RBAC to avoid circular reference issues
      const { RBAC } = await import('./rbac.js');

      // Save a custom role to storage
      const customRole: RoleDefinition = {
        id: 'role_custom_ops',
        name: 'Custom Ops',
        description: 'Custom operations role',
        permissions: [{ resource: 'custom', actions: ['read', 'execute'] }],
      };
      storage.saveRoleDefinition(customRole);

      // Create RBAC with storage — should load the custom role
      const rbac = new RBAC(storage);

      const result = rbac.checkPermission('custom_ops', {
        resource: 'custom',
        action: 'read',
      });
      expect(result.granted).toBe(true);
    });

    it('should load persisted user-role assignments on construction', async () => {
      const { RBAC } = await import('./rbac.js');

      // Save a user-role assignment to storage
      storage.assignRole('user_test', 'role_operator', 'admin');

      // Create RBAC with storage — should load the assignment
      const rbac = new RBAC(storage);

      const role = rbac.getUserRole('user_test');
      expect(role).toBe('role_operator');
    });

    it('should persist role definitions through defineRole', async () => {
      const { RBAC } = await import('./rbac.js');

      const rbac = new RBAC(storage);

      // Define a role through RBAC — should persist to storage
      rbac.defineRole({
        id: 'role_dynamic',
        name: 'Dynamic',
        permissions: [{ resource: 'dynamic', actions: ['read'] }],
      });

      // Verify it's in storage
      const persisted = storage.getRoleDefinition('role_dynamic');
      expect(persisted).not.toBeNull();
      expect(persisted!.name).toBe('Dynamic');
    });

    it('should persist user-role assignments through assignUserRole', async () => {
      const { RBAC } = await import('./rbac.js');

      const rbac = new RBAC(storage);

      rbac.assignUserRole('user_new', 'role_admin', 'system');

      // Verify in-memory
      expect(rbac.getUserRole('user_new')).toBe('role_admin');

      // Verify in storage
      expect(storage.getActiveRole('user_new')).toBe('role_admin');
    });

    it('should persist role revocations', async () => {
      const { RBAC } = await import('./rbac.js');

      const rbac = new RBAC(storage);

      rbac.assignUserRole('user_temp', 'role_viewer', 'admin');
      rbac.revokeUserRole('user_temp');

      // In-memory should be cleared
      expect(rbac.getUserRole('user_temp')).toBeUndefined();

      // Storage should show revoked
      expect(storage.getActiveRole('user_temp')).toBeNull();
    });
  });
});
