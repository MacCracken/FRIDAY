/**
 * Input Validation and Sanitization Pipeline for SecureClaw
 *
 * Security considerations:
 * - Multi-stage validation pipeline
 * - Injection detection (prompt injection, SQL, XSS)
 * - Size limits to prevent DoS
 * - Encoding normalization to prevent unicode tricks
 * - All validation results are logged for audit
 */
import type { SecurityConfig } from '@friday/shared';
export interface ValidationResult {
    valid: boolean;
    sanitized: string;
    warnings: ValidationWarning[];
    blocked: boolean;
    blockReason?: string;
}
export interface ValidationWarning {
    code: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    position?: number;
    pattern?: string;
}
export interface ValidationContext {
    userId?: string;
    source?: string;
    correlationId?: string;
}
export declare class InputValidator {
    private readonly config;
    private logger;
    constructor(config: SecurityConfig['inputValidation']);
    private getLogger;
    /**
     * Validate and sanitize input
     */
    validate(input: string, context?: ValidationContext): ValidationResult;
    /**
     * Normalize encoding and remove dangerous unicode
     */
    private normalizeEncoding;
    /**
     * Detect injection attempts
     */
    private detectInjection;
    /**
     * Validate file content (with additional checks)
     */
    validateFileContent(content: Buffer, filename: string, context?: ValidationContext): ValidationResult & {
        mimeType?: string;
    };
    /**
     * Check if content is likely text
     */
    private isLikelyText;
}
/**
 * Create a validator instance from config
 */
export declare function createValidator(config: SecurityConfig): InputValidator;
//# sourceMappingURL=input-validator.d.ts.map