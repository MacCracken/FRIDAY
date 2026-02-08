/**
 * Role-Based Access Control (RBAC) for SecureClaw
 *
 * Security considerations:
 * - Deny by default - all permissions must be explicitly granted
 * - Role hierarchy with inheritance
 * - Permission caching for performance
 * - Audit logging of all permission checks
 */
import { type Permission, type RoleDefinition } from '@friday/shared';
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
export declare class RBAC {
    private readonly roles;
    private readonly permissionCache;
    private readonly cacheMaxSize;
    private logger;
    constructor();
    private getLogger;
    /**
     * Add or update a role definition
     */
    defineRole(role: RoleDefinition): void;
    /**
     * Remove a role definition
     */
    removeRole(roleId: string): boolean;
    /**
     * Get a role definition by ID or name
     */
    getRole(roleIdOrName: string): RoleDefinition | undefined;
    /**
     * Check if a role has permission for an action on a resource
     */
    checkPermission(roleIdOrName: string, check: PermissionCheck, userId?: string): PermissionResult;
    /**
     * Check permissions for a role (including inherited)
     */
    private checkRolePermissions;
    /**
     * Check if a permission matches a check
     */
    private matchesPermission;
    /**
     * Evaluate a permission condition
     */
    private evaluateCondition;
    /**
     * Cache a permission result
     */
    private cacheResult;
    /**
     * Clear the permission cache
     */
    clearCache(): void;
    /**
     * Log a permission check for audit
     */
    private logPermissionCheck;
    /**
     * Get all defined roles
     */
    getAllRoles(): RoleDefinition[];
    /**
     * Require permission (throws if denied)
     */
    requirePermission(roleIdOrName: string, check: PermissionCheck, userId?: string): void;
}
/**
 * Error thrown when permission is denied
 */
export declare class PermissionDeniedError extends Error {
    readonly resource: string;
    readonly action: string;
    readonly reason?: string;
    constructor(resource: string, action: string, reason?: string);
}
/**
 * Get the global RBAC instance
 */
export declare function getRBAC(): RBAC;
/**
 * Initialize RBAC with custom configuration
 */
export declare function initializeRBAC(customRoles?: RoleDefinition[]): RBAC;
//# sourceMappingURL=rbac.d.ts.map