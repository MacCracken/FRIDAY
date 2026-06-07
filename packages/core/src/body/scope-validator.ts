/**
 * Scope Validator
 *
 * Validates capture scope against role-based limits and sanitizes
 * user input to enforce security policies.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_03: Scope Limiting Controls
 */

import { getLogger, type SecureLogger } from '../logging/logger.js';
import { getRBAC } from '../security/rbac.js';
import type { CaptureScope, CaptureResource, CaptureResolution } from './types.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the scope is valid */
  valid: boolean;

  /** Error messages if invalid */
  errors: string[];

  /** Sanitized scope within role limits */
  sanitizedScope?: CaptureScope;

  /** Warnings (non-blocking issues) */
  warnings?: string[];
}

/**
 * Role-based scope limits
 */
export interface RoleScopeLimits {
  /** Maximum duration in seconds */
  maxDuration: number;

  /** Allowed resources */
  allowedResources: CaptureResource[];

  /** Allowed resolutions */
  allowedResolutions: CaptureResolution[];

  /** Whether native resolution is allowed */
  allowNativeResolution: boolean;

  /** Maximum frame rate */
  maxFrameRate: number;

  /** Whether streaming is allowed */
  allowStreaming: boolean;

  /** Whether filters can be applied */
  allowFilters: boolean;

  /** Whether restrictions can be set */
  allowRestrictions: boolean;
}

/**
 * Default limits by role
 */
export const DEFAULT_ROLE_LIMITS: Record<string, RoleScopeLimits> = {
  role_admin: {
    maxDuration: 3600, // 1 hour
    allowedResources: [
      'capture.screen',
      'capture.camera',
      'capture.clipboard',
      'capture.keystrokes',
    ],
    allowedResolutions: ['native', '1080p', '720p', '480p', '360p'],
    allowNativeResolution: true,
    maxFrameRate: 60,
    allowStreaming: true,
    allowFilters: true,
    allowRestrictions: true,
  },
  role_operator: {
    maxDuration: 300, // 5 minutes
    allowedResources: ['capture.screen', 'capture.camera'],
    allowedResolutions: ['1080p', '720p', '480p', '360p'],
    allowNativeResolution: false,
    maxFrameRate: 30,
    allowStreaming: false,
    allowFilters: true,
    allowRestrictions: true,
  },
  role_capture_operator: {
    maxDuration: 1800, // 30 minutes
    allowedResources: ['capture.screen', 'capture.camera', 'capture.clipboard'],
    allowedResolutions: ['native', '1080p', '720p', '480p', '360p'],
    allowNativeResolution: true,
    maxFrameRate: 60,
    allowStreaming: true,
    allowFilters: true,
    allowRestrictions: true,
  },
  role_auditor: {
    maxDuration: 0, // No capture, review only
    allowedResources: [],
    allowedResolutions: [],
    allowNativeResolution: false,
    maxFrameRate: 0,
    allowStreaming: false,
    allowFilters: false,
    allowRestrictions: false,
  },
  role_security_auditor: {
    maxDuration: 0, // No capture, review only
    allowedResources: [],
    allowedResolutions: [],
    allowNativeResolution: false,
    maxFrameRate: 0,
    allowStreaming: false,
    allowFilters: false,
    allowRestrictions: false,
  },
  role_viewer: {
    maxDuration: 0, // No capture
    allowedResources: [],
    allowedResolutions: [],
    allowNativeResolution: false,
    maxFrameRate: 0,
    allowStreaming: false,
    allowFilters: false,
    allowRestrictions: false,
  },
};

/**
 * Scope validation options
 */
export interface ScopeValidationOptions {
  /** Role to validate against */
  roleId: string;

  /** User ID for audit logging */
  userId?: string;

  /** Whether to auto-sanitize or reject on limit violation */
  mode?: 'strict' | 'sanitize';
}

/**
 * Scope validation error
 */
export class ScopeValidationError extends Error {
  public readonly errors: string[];
  public readonly scope: CaptureScope;

  constructor(errors: string[], scope: CaptureScope) {
    super(`Scope validation failed: ${errors.join(', ')}`);
    this.name = 'ScopeValidationError';
    this.errors = errors;
    this.scope = scope;
  }
}

/**
 * Validates capture scope against role limits
 */
export class ScopeValidator {
  private logger: SecureLogger;
  private roleLimits: Map<string, RoleScopeLimits>;

  constructor(customLimits?: Record<string, RoleScopeLimits>) {
    this.roleLimits = new Map(Object.entries(customLimits ?? DEFAULT_ROLE_LIMITS));

    // Initialize logger
    try {
      this.logger = getLogger().child({ component: 'ScopeValidator' });
    } catch {
      this.logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => this.logger,
        level: 'info',
      };
    }
  }

  /**
   * Validate a capture scope against role limits
   *
   * @param scope - The capture scope to validate
   * @param options - Validation options including role
   * @returns Validation result with errors and sanitized scope
   */
  validate(scope: CaptureScope, options: ScopeValidationOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { roleId, userId, mode = 'sanitize' } = options;

    // Get role limits
    const limits = this.roleLimits.get(roleId);
    if (!limits) {
      errors.push(`Unknown role: ${roleId}`);
      return { valid: false, errors, warnings };
    }

    // Validate resource
    if (!limits.allowedResources.includes(scope.resource)) {
      errors.push(
        `Resource ${scope.resource} not allowed for role ${roleId}. Allowed: ${limits.allowedResources.join(', ')}`
      );
    }

    // Validate duration
    if (scope.duration.maxSeconds > limits.maxDuration) {
      if (mode === 'strict') {
        errors.push(
          `Duration ${scope.duration.maxSeconds}s exceeds role limit of ${limits.maxDuration}s`
        );
      } else {
        warnings.push(
          `Duration reduced from ${scope.duration.maxSeconds}s to ${limits.maxDuration}s`
        );
      }
    }

    // Validate resolution
    if (!limits.allowedResolutions.includes(scope.quality.resolution)) {
      errors.push(`Resolution ${scope.quality.resolution} not allowed for role ${roleId}`);
    }

    // Validate native resolution permission
    if (scope.quality.resolution === 'native' && !limits.allowNativeResolution) {
      if (mode === 'strict') {
        errors.push('Native resolution not allowed for this role');
      } else {
        warnings.push('Resolution downgraded from native to 1080p');
      }
    }

    // Validate frame rate
    if (scope.quality.frameRate > limits.maxFrameRate) {
      if (mode === 'strict') {
        errors.push(
          `Frame rate ${scope.quality.frameRate} exceeds limit of ${limits.maxFrameRate}`
        );
      } else {
        warnings.push(
          `Frame rate reduced from ${scope.quality.frameRate} to ${limits.maxFrameRate}`
        );
      }
    }

    // Validate filters
    if (scope.filters && !limits.allowFilters) {
      warnings.push('Filters not allowed for this role, will be ignored');
    }

    // Validate filters don't break functionality
    if (scope.filters?.redactPatterns) {
      for (const pattern of scope.filters.redactPatterns) {
        try {
          new RegExp(pattern);
        } catch {
          errors.push(`Invalid regex pattern: ${pattern}`);
        }
      }
    }

    // Validate restrictions
    if (scope.restrictions && !limits.allowRestrictions) {
      warnings.push('Restrictions not allowed for this role, will be ignored');
    }

    // Log validation
    const logLevel = errors.length > 0 ? 'warn' : 'debug';
    this.logger[logLevel]('Scope validation', {
      userId,
      roleId,
      resource: scope.resource,
      valid: errors.length === 0,
      errors,
      warnings,
    });

    // Build result
    const valid = errors.length === 0;
    let sanitizedScope: CaptureScope | undefined;

    if (valid || mode === 'sanitize') {
      sanitizedScope = this.sanitizeScope(scope, limits, warnings);
    }

    return {
      valid,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
      sanitizedScope,
    };
  }

  /**
   * Validate scope and throw on error
   *
   * @throws ScopeValidationError if validation fails
   */
  validateOrThrow(scope: CaptureScope, options: ScopeValidationOptions): CaptureScope {
    const result = this.validate(scope, options);

    if (!result.valid) {
      throw new ScopeValidationError(result.errors, scope);
    }

    return result.sanitizedScope ?? scope;
  }

  /**
   * Check if a user can capture with the given scope
   * Combines RBAC check with scope validation
   */
  async checkPermissionAndValidate(
    scope: CaptureScope,
    userId: string,
    roleId: string,
    action: 'capture' | 'stream' = 'capture'
  ): Promise<{ allowed: boolean; sanitizedScope?: CaptureScope; error?: string }> {
    // First check RBAC
    const rbac = getRBAC();
    const rbacResult = rbac.checkPermission(
      roleId,
      { resource: scope.resource, action, context: { duration: scope.duration.maxSeconds } },
      userId
    );

    if (!rbacResult.granted) {
      return {
        allowed: false,
        error: rbacResult.reason || 'Permission denied by RBAC',
      };
    }

    // Then validate scope
    const validation = this.validate(scope, { roleId, userId, mode: 'sanitize' });

    if (!validation.valid && !validation.sanitizedScope) {
      return {
        allowed: false,
        error: validation.errors.join(', '),
      };
    }

    return {
      allowed: true,
      sanitizedScope: validation.sanitizedScope,
    };
  }

  /**
   * Get limits for a role
   */
  getRoleLimits(roleId: string): RoleScopeLimits | undefined {
    return this.roleLimits.get(roleId);
  }

  /**
   * Set custom limits for a role
   */
  setRoleLimits(roleId: string, limits: RoleScopeLimits): void {
    this.roleLimits.set(roleId, limits);
    this.logger.info({ roleId }, 'Role limits updated');
  }

  /**
   * Sanitize scope to fit within role limits
   */
  private sanitizeScope(
    scope: CaptureScope,
    limits: RoleScopeLimits,
    _warnings: string[]
  ): CaptureScope {
    const sanitized: CaptureScope = {
      ...scope,
      duration: {
        ...scope.duration,
        maxSeconds: Math.min(scope.duration.maxSeconds, limits.maxDuration),
      },
      quality: {
        ...scope.quality,
        resolution:
          scope.quality.resolution === 'native' && !limits.allowNativeResolution
            ? '1080p'
            : scope.quality.resolution,
        frameRate: Math.min(scope.quality.frameRate, limits.maxFrameRate),
      },
    };

    // Remove filters if not allowed
    if (scope.filters && !limits.allowFilters) {
      delete sanitized.filters;
    }

    // Remove restrictions if not allowed
    if (scope.restrictions && !limits.allowRestrictions) {
      delete sanitized.restrictions;
    }

    return sanitized;
  }
}

/**
 * Global scope validator instance
 */
let globalValidator: ScopeValidator | null = null;

/**
 * Initialize the global scope validator
 */
export function initializeScopeValidator(
  customLimits?: Record<string, RoleScopeLimits>
): ScopeValidator {
  globalValidator = new ScopeValidator(customLimits);
  return globalValidator;
}

/**
 * Get the global scope validator instance
 */
export function getScopeValidator(): ScopeValidator {
  if (!globalValidator) {
    globalValidator = new ScopeValidator();
  }
  return globalValidator;
}

/**
 * Reset the global scope validator (for testing)
 */
export function resetScopeValidator(): void {
  globalValidator = null;
}
