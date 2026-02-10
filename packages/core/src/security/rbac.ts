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
  
  constructor() {
    // Initialize with default roles
    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.id, role);
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
   * Add or update a role definition
   */
  defineRole(role: RoleDefinition): void {
    this.roles.set(role.id, role);
    this.clearCache(); // Invalidate cache on role change
    this.getLogger().info('Role defined', { roleId: role.id, roleName: role.name });
  }
  
  /**
   * Remove a role definition
   */
  removeRole(roleId: string): boolean {
    const removed = this.roles.delete(roleId);
    if (removed) {
      this.clearCache();
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
 * Get the global RBAC instance
 */
export function getRBAC(): RBAC {
  rbacInstance ??= new RBAC();
  return rbacInstance;
}

/**
 * Initialize RBAC with custom configuration
 */
export function initializeRBAC(customRoles?: RoleDefinition[]): RBAC {
  rbacInstance = new RBAC();
  
  if (customRoles) {
    for (const role of customRoles) {
      rbacInstance.defineRole(role);
    }
  }
  
  return rbacInstance;
}
