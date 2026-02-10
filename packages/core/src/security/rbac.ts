/**
 * Role-Based Access Control (RBAC) for SecureYeoman
 * 
 * Security considerations:
 * - Deny by default - all permissions must be explicitly granted
 * - Role hierarchy with inheritance
 * - Permission caching for performance
 * - Audit logging of all permission checks
 */

import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import {
  RoleSchema,
  type Permission,
  type RoleDefinition,
} from '@friday/shared';
import type { RBACStorage } from './rbac-storage.js';

// Default role definitions
const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'role_admin',
    name: 'Administrator',
    description: 'Full system access',
    permissions: [
      { resource: '*', actions: ['*'] },
    ],
  },
  {
    id: 'role_operator',
    name: 'Operator',
    description: 'Can manage tasks and connections',
    permissions: [
      { resource: 'tasks', actions: ['read', 'write', 'execute', 'cancel'] },
      { resource: 'connections', actions: ['read', 'write', 'delete', 'test'] },
      { resource: 'metrics', actions: ['read'] },
      { resource: 'logs', actions: ['read'] },
      { resource: 'soul', actions: ['read', 'write'] },
    ],
  },
  {
    id: 'role_auditor',
    name: 'Auditor',
    description: 'Read-only access to logs and audit trail',
    permissions: [
      { resource: 'logs', actions: ['read', 'export'] },
      { resource: 'audit', actions: ['read', 'export', 'verify'] },
      { resource: 'metrics', actions: ['read'] },
      { resource: 'security_events', actions: ['read'] },
      { resource: 'tasks', actions: ['read'] },
    ],
  },
  {
    id: 'role_viewer',
    name: 'Viewer',
    description: 'Read-only access to metrics and tasks',
    permissions: [
      { resource: 'metrics', actions: ['read'] },
      { resource: 'tasks', actions: ['read'] },
      { resource: 'connections', actions: ['read'] },
      { resource: 'soul', actions: ['read'] },
    ],
  },
];

export interface PermissionCheck {
  resource: string;
  action: string;
  context?: Record<string, unknown>;
}

export interface PermissionResult {
  granted: boolean;
  reason?: string;
  matchedPermission?: Permission;
}

export class RBAC {
  private readonly roles = new Map<string, RoleDefinition>();
  private readonly permissionCache = new Map<string, boolean>();
  private readonly cacheMaxSize = 1000;
  private logger: SecureLogger | null = null;

  /**
   * Optional persistent storage backend for role definitions and user-role
   * assignments.  When provided, role mutations (defineRole / removeRole)
   * and user assignment operations are automatically persisted to SQLite so
   * they survive process restarts.
   *
   * When null (the default for backwards compatibility and testing), the
   * RBAC system operates entirely in-memory as before.
   */
  private storage: RBACStorage | null = null;

  /**
   * In-memory map of userId → roleId for user-role assignments.
   * Populated from persistent storage at construction time (if available)
   * and kept in sync on every assign/revoke call.
   */
  private readonly userRoles = new Map<string, string>();

  /**
   * Create a new RBAC instance.
   *
   * @param storage — Optional RBACStorage for persistence.  When provided,
   *   persisted custom role definitions are loaded on construction and
   *   merged with the hard-coded defaults (persisted roles take precedence).
   *   User-role assignments are also loaded into memory for fast lookups.
   */
  constructor(storage?: RBACStorage) {
    // Initialize with default roles
    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.id, role);
    }

    // If persistent storage is provided, load any previously saved custom
    // roles and user-role assignments into memory so they're immediately
    // available for permission checks.
    if (storage) {
      this.storage = storage;

      // Merge persisted custom role definitions on top of defaults.
      // Persisted roles override defaults when IDs collide — this allows
      // admins to customise the built-in roles via the API.
      const persistedRoles = storage.getAllRoleDefinitions();
      for (const role of persistedRoles) {
        this.roles.set(role.id, role);
      }

      // Load active user-role assignments into the in-memory map.
      const assignments = storage.listActiveAssignments();
      for (const assignment of assignments) {
        this.userRoles.set(assignment.userId, assignment.roleId);
      }
    }
  }
  
  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'RBAC' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }
  
  /**
   * Add or update a role definition.
   *
   * When persistent storage is configured, the role is also written to
   * SQLite so it survives process restarts.  The in-memory permission
   * cache is invalidated because the new/updated role may change the
   * outcome of cached permission checks.
   */
  defineRole(role: RoleDefinition): void {
    this.roles.set(role.id, role);
    this.clearCache(); // Invalidate cache on role change

    // Persist to SQLite when storage is available.
    if (this.storage) {
      this.storage.saveRoleDefinition(role);
    }

    this.getLogger().info('Role defined', { roleId: role.id, roleName: role.name });
  }

  /**
   * Remove a role definition.
   *
   * When persistent storage is configured, the role is also deleted from
   * SQLite.  Note: this does NOT automatically revoke user assignments
   * referencing this role — the application layer should handle that to
   * avoid dangling references.
   */
  removeRole(roleId: string): boolean {
    const removed = this.roles.delete(roleId);
    if (removed) {
      this.clearCache();

      // Remove from persistent storage as well.
      if (this.storage) {
        this.storage.deleteRoleDefinition(roleId);
      }

      this.getLogger().info('Role removed', { roleId });
    }
    return removed;
  }
  
  /**
   * Get a role definition by ID or name
   */
  getRole(roleIdOrName: string): RoleDefinition | undefined {
    // Try by ID first
    let role = this.roles.get(roleIdOrName);
    
    if (!role) {
      // Try by name (convert to role_name format)
      const roleId = `role_${roleIdOrName.toLowerCase()}`;
      role = this.roles.get(roleId);
    }
    
    return role;
  }
  
  /**
   * Check if a role has permission for an action on a resource
   */
  checkPermission(
    roleIdOrName: string,
    check: PermissionCheck,
    userId?: string
  ): PermissionResult {
    // Validate role name
    const roleParseResult = RoleSchema.safeParse(roleIdOrName.toLowerCase());
    const normalizedRole = roleParseResult.success 
      ? roleIdOrName.toLowerCase() 
      : roleIdOrName;
    
    // Check cache first
    const cacheKey = `${normalizedRole}:${check.resource}:${check.action}`;
    const cached = this.permissionCache.get(cacheKey);
    
    if (cached !== undefined) {
      return {
        granted: cached,
        reason: cached ? 'Cached grant' : 'Cached denial',
      };
    }
    
    // Get role definition
    const role = this.getRole(normalizedRole);
    
    if (!role) {
      this.logPermissionCheck(userId, check, false, 'Role not found');
      return {
        granted: false,
        reason: `Role not found: ${normalizedRole}`,
      };
    }
    
    // Check permissions
    const result = this.checkRolePermissions(role, check);
    
    // Cache the result
    this.cacheResult(cacheKey, result.granted);
    
    // Log the check
    this.logPermissionCheck(userId, check, result.granted, result.reason);
    
    return result;
  }
  
  /**
   * Check permissions for a role (including inherited)
   */
  private checkRolePermissions(
    role: RoleDefinition,
    check: PermissionCheck,
    visited = new Set<string>()
  ): PermissionResult {
    // Prevent circular inheritance
    if (visited.has(role.id)) {
      return {
        granted: false,
        reason: 'Circular role inheritance detected',
      };
    }
    visited.add(role.id);
    
    // Check direct permissions
    for (const permission of role.permissions) {
      if (this.matchesPermission(permission, check)) {
        return {
          granted: true,
          reason: `Matched permission on ${permission.resource}`,
          matchedPermission: permission,
        };
      }
    }
    
    // Check inherited roles
    if (role.inheritFrom) {
      for (const inheritedRoleId of role.inheritFrom) {
        const inheritedRole = this.roles.get(inheritedRoleId);
        if (inheritedRole) {
          const result = this.checkRolePermissions(inheritedRole, check, visited);
          if (result.granted) {
            return {
              ...result,
              reason: `Inherited from ${inheritedRole.name}: ${result.reason ?? 'granted'}`,
            };
          }
        }
      }
    }
    
    // Default deny
    return {
      granted: false,
      reason: 'No matching permission found',
    };
  }
  
  /**
   * Check if a permission matches a check
   */
  private matchesPermission(permission: Permission, check: PermissionCheck): boolean {
    // Check resource match (supports wildcards)
    const resourceMatch = 
      permission.resource === '*' ||
      permission.resource === check.resource ||
      (permission.resource.endsWith('*') && 
       check.resource.startsWith(permission.resource.slice(0, -1)));
    
    if (!resourceMatch) {
      return false;
    }
    
    // Check action match (supports wildcards)
    const actionMatch =
      permission.actions.includes('*') ||
      permission.actions.includes(check.action);
    
    if (!actionMatch) {
      return false;
    }
    
    // Check conditions if present
    if (permission.conditions && check.context) {
      for (const condition of permission.conditions) {
        const value = check.context[condition.field];
        // Skip conditions without a value defined
        if (condition.value === undefined) {
          continue;
        }
        if (!this.evaluateCondition({ ...condition, value: condition.value }, value)) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Evaluate a permission condition
   */
  private evaluateCondition(
    condition: { field: string; operator: string; value: unknown },
    actualValue: unknown
  ): boolean {
    switch (condition.operator) {
      case 'eq':
        return actualValue === condition.value;
      case 'neq':
        return actualValue !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(actualValue);
      case 'nin':
        return Array.isArray(condition.value) && !condition.value.includes(actualValue);
      case 'gt':
        return typeof actualValue === 'number' && 
               typeof condition.value === 'number' && 
               actualValue > condition.value;
      case 'gte':
        return typeof actualValue === 'number' && 
               typeof condition.value === 'number' && 
               actualValue >= condition.value;
      case 'lt':
        return typeof actualValue === 'number' && 
               typeof condition.value === 'number' && 
               actualValue < condition.value;
      case 'lte':
        return typeof actualValue === 'number' && 
               typeof condition.value === 'number' && 
               actualValue <= condition.value;
      default:
        return false;
    }
  }
  
  /**
   * Cache a permission result
   */
  private cacheResult(key: string, granted: boolean): void {
    // Evict oldest entries if cache is full
    if (this.permissionCache.size >= this.cacheMaxSize) {
      const firstKey = this.permissionCache.keys().next().value;
      if (firstKey) {
        this.permissionCache.delete(firstKey);
      }
    }
    
    this.permissionCache.set(key, granted);
  }
  
  /**
   * Clear the permission cache
   */
  clearCache(): void {
    this.permissionCache.clear();
  }
  
  /**
   * Log a permission check for audit
   */
  private logPermissionCheck(
    userId: string | undefined,
    check: PermissionCheck,
    granted: boolean,
    reason?: string
  ): void {
    const logLevel = granted ? 'debug' : 'info';
    this.getLogger()[logLevel]('Permission check', {
      userId,
      resource: check.resource,
      action: check.action,
      granted,
      reason,
    });
  }
  
  /**
   * Get all defined roles
   */
  getAllRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  /**
   * Require permission (throws if denied)
   */
  requirePermission(
    roleIdOrName: string,
    check: PermissionCheck,
    userId?: string
  ): void {
    const result = this.checkPermission(roleIdOrName, check, userId);

    if (!result.granted) {
      throw new PermissionDeniedError(
        check.resource,
        check.action,
        result.reason
      );
    }
  }

  // ── User-role assignment methods ────────────────────────────────────

  /**
   * Assign a role to a user.
   *
   * Updates the in-memory map immediately for instant effect on subsequent
   * permission checks, and persists to SQLite when storage is available so
   * the assignment survives restarts.
   *
   * If the user already has a role, the old assignment is automatically
   * revoked and replaced with the new one (both in memory and on disk).
   *
   * @param userId     — The user to assign the role to.
   * @param roleId     — The role ID to assign (e.g. "role_operator").
   * @param assignedBy — Who is performing the assignment (for audit trail).
   * @throws Error if the roleId doesn't refer to a known role definition.
   */
  assignUserRole(userId: string, roleId: string, assignedBy: string): void {
    // Validate that the role actually exists before assigning it.
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Cannot assign unknown role: ${roleId}`);
    }

    // Update in-memory map for immediate effect.
    this.userRoles.set(userId, roleId);

    // Invalidate permission cache because this user's effective permissions
    // may have changed.
    this.clearCache();

    // Persist to SQLite when storage is available.
    if (this.storage) {
      this.storage.assignRole(userId, roleId, assignedBy);
    }

    this.getLogger().info('User role assigned', { userId, roleId, assignedBy });
  }

  /**
   * Revoke the active role assignment for a user.
   *
   * Removes the mapping from the in-memory map and soft-deletes the
   * assignment in SQLite (sets revoked_at) when storage is available.
   *
   * @returns true if the user had an active role that was revoked.
   */
  revokeUserRole(userId: string): boolean {
    const had = this.userRoles.delete(userId);

    if (had) {
      this.clearCache();

      if (this.storage) {
        this.storage.revokeRole(userId);
      }

      this.getLogger().info('User role revoked', { userId });
    }

    return had;
  }

  /**
   * Get the currently assigned role for a user.
   *
   * Reads from the in-memory map (O(1) lookup) — the map is populated
   * from SQLite at construction time and kept in sync by assign/revoke.
   *
   * @returns The role ID string, or undefined if the user has no assignment.
   */
  getUserRole(userId: string): string | undefined {
    return this.userRoles.get(userId);
  }

  /**
   * List all active user-role assignments.
   *
   * Returns an array of {userId, roleId} pairs for all users who currently
   * have an active role assignment.  Useful for admin dashboards and bulk
   * operations.
   */
  listUserAssignments(): Array<{ userId: string; roleId: string }> {
    return Array.from(this.userRoles.entries()).map(([userId, roleId]) => ({
      userId,
      roleId,
    }));
  }

  /**
   * Get the full role assignment history for a user (requires storage).
   *
   * Includes both active and revoked assignments, ordered newest first.
   * Returns an empty array when no persistent storage is configured.
   */
  getUserRoleHistory(userId: string): Array<{
    roleId: string;
    assignedBy: string;
    assignedAt: number;
    revokedAt: number | null;
  }> {
    if (!this.storage) {
      return [];
    }

    return this.storage.getAssignmentHistory(userId).map((row) => ({
      roleId: row.role_id,
      assignedBy: row.assigned_by,
      assignedAt: row.assigned_at,
      revokedAt: row.revoked_at,
    }));
  }
}

/**
 * Error thrown when permission is denied
 */
export class PermissionDeniedError extends Error {
  public readonly resource: string;
  public readonly action: string;
  public readonly reason?: string;
  
  constructor(resource: string, action: string, reason?: string) {
    super(`Permission denied: ${action} on ${resource}${reason ? ` (${reason})` : ''}`);
    this.name = 'PermissionDeniedError';
    this.resource = resource;
    this.action = action;
    this.reason = reason;
  }
}

// Singleton instance
let rbacInstance: RBAC | null = null;

/**
 * Get the global RBAC instance.
 *
 * Creates a new in-memory-only instance on first call if none has been
 * initialised yet.  Prefer calling initializeRBAC() at startup to
 * configure persistent storage.
 */
export function getRBAC(): RBAC {
  rbacInstance ??= new RBAC();
  return rbacInstance;
}

/**
 * Initialize RBAC with custom configuration and optional persistent storage.
 *
 * Replaces the global singleton with a new instance.  When a storage
 * backend is provided, persisted custom roles and user-role assignments
 * are loaded automatically from SQLite on construction.
 *
 * @param customRoles — Additional role definitions to register on startup.
 * @param storage     — Optional RBACStorage for SQLite-backed persistence.
 *                      When omitted, the RBAC system operates in-memory only
 *                      (backwards compatible with the previous behaviour).
 */
export function initializeRBAC(customRoles?: RoleDefinition[], storage?: RBACStorage): RBAC {
  rbacInstance = new RBAC(storage);

  if (customRoles) {
    for (const role of customRoles) {
      rbacInstance.defineRole(role);
    }
  }

  return rbacInstance;
}
