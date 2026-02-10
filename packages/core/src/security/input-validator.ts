/**
 * Input Validation and Sanitization Pipeline for SecureYeoman
 * 
 * Security considerations:
 * - Multi-stage validation pipeline
 * - Injection detection (prompt injection, SQL, XSS)
 * - Size limits to prevent DoS
 * - Encoding normalization to prevent unicode tricks
 * - All validation results are logged for audit
 */

import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
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

// Injection patterns to detect
const INJECTION_PATTERNS: {
  name: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
  block: boolean;
}[] = [
  // Prompt injection attempts
  {
    name: 'prompt_injection_system',
    pattern: /\[\[SYSTEM\]\]|\{\{system\}\}|<\|system\|>|<<SYS>>|<s>\[INST\]/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'prompt_injection_ignore',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'prompt_injection_forget',
    pattern: /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|training|context)/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'prompt_injection_pretend',
    pattern: /pretend\s+(you\s+are|to\s+be|you're)\s+(a\s+)?(different|new|another)\s+(ai|assistant|bot)/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'prompt_injection_jailbreak',
    pattern: /DAN\s*mode|developer\s*mode|jailbreak|do\s*anything\s*now/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'prompt_injection_roleplay',
    pattern: /you\s+are\s+now\s+(in\s+)?(unrestricted|unfiltered|uncensored)\s+mode/gi,
    severity: 'high',
    block: true,
  },
  
  // SQL injection (for when we interact with databases)
  {
    name: 'sql_injection',
    pattern: /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|EXEC)\s+/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'sql_union',
    pattern: /UNION\s+(ALL\s+)?SELECT/gi,
    severity: 'medium',
    block: false,
  },
  
  // XSS (for when output might be rendered)
  {
    name: 'xss_script',
    pattern: /<script[^>]*>[\s\S]*?<\/script>/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'xss_event_handler',
    pattern: /\bon\w+\s*=\s*["'][^"']*["']/gi,
    severity: 'medium',
    block: false,
  },
  {
    name: 'xss_javascript_uri',
    pattern: /javascript\s*:/gi,
    severity: 'high',
    block: true,
  },
  
  // Command injection
  {
    name: 'command_injection',
    pattern: /;\s*(rm|chmod|chown|sudo|su|wget|curl)\s+/gi,
    severity: 'high',
    block: true,
  },
  {
    name: 'command_substitution',
    pattern: /\$\([^)]+\)|`[^`]+`/g,
    severity: 'medium',
    block: false,
  },
  
  // Path traversal
  {
    name: 'path_traversal',
    pattern: /\.\.[/\\]/g,
    severity: 'high',
    block: true,
  },
  
  // Template injection
  {
    name: 'template_injection',
    pattern: /\{\{[^}]*\}\}|\$\{[^}]*\}/g,
    severity: 'medium',
    block: false,
  },
];

// Characters that should be normalized or removed
const DANGEROUS_UNICODE: RegExp[] = [
  /[\u200B-\u200D\uFEFF]/g, // Zero-width characters
  /[\u202A-\u202E]/g, // Bidirectional override
  /[\u2066-\u2069]/g, // Bidirectional isolate
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, // Control characters (except tab, newline, CR)
];

export class InputValidator {
  private readonly config: SecurityConfig['inputValidation'];
  private logger: SecureLogger | null = null;
  
  constructor(config: SecurityConfig['inputValidation']) {
    this.config = config;
  }
  
  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'InputValidator' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }
  
  /**
   * Validate and sanitize input
   */
  validate(input: string, context: ValidationContext = {}): ValidationResult {
    const warnings: ValidationWarning[] = [];
    let sanitized = input;
    let blocked = false;
    let blockReason: string | undefined;
    
    // Stage 1: Size check
    if (input.length > this.config.maxInputLength) {
      this.getLogger().warn('Input exceeds size limit', {
        ...context,
        inputLength: input.length,
        maxLength: this.config.maxInputLength,
      });
      
      return {
        valid: false,
        sanitized: '',
        warnings: [{
          code: 'SIZE_EXCEEDED',
          message: `Input exceeds maximum length of ${this.config.maxInputLength}`,
          severity: 'high',
        }],
        blocked: true,
        blockReason: 'Input size exceeds limit',
      };
    }
    
    // Stage 2: Encoding normalization
    sanitized = this.normalizeEncoding(sanitized, warnings);
    
    // Stage 3: Injection detection
    if (this.config.enableInjectionDetection) {
      const injectionResult = this.detectInjection(sanitized, context);
      warnings.push(...injectionResult.warnings);
      
      if (injectionResult.blocked) {
        blocked = true;
        blockReason = injectionResult.blockReason;
      }
      
      // Sanitize detected patterns (if not blocking)
      if (!blocked) {
        sanitized = injectionResult.sanitized;
      }
    }
    
    // Stage 4: Null byte removal (critical for path safety)
    if (sanitized.includes('\0')) {
      warnings.push({
        code: 'NULL_BYTE',
        message: 'Null bytes detected and removed',
        severity: 'high',
      });
      sanitized = sanitized.replace(/\0/g, '');
    }
    
    const result: ValidationResult = {
      valid: !blocked,
      sanitized: blocked ? '' : sanitized,
      warnings,
      blocked,
      blockReason,
    };
    
    // Log validation result for audit
    if (warnings.length > 0 || blocked) {
      this.getLogger().info('Input validation completed with warnings', {
        ...context,
        valid: result.valid,
        blocked: result.blocked,
        warningCount: warnings.length,
        warnings: warnings.map(w => w.code),
      });
    }
    
    return result;
  }
  
  /**
   * Normalize encoding and remove dangerous unicode
   */
  private normalizeEncoding(input: string, warnings: ValidationWarning[]): string {
    let result = input;
    
    // Normalize to NFC form
    result = result.normalize('NFC');
    
    // Remove dangerous unicode characters
    for (const pattern of DANGEROUS_UNICODE) {
      if (pattern.test(result)) {
        warnings.push({
          code: 'DANGEROUS_UNICODE',
          message: 'Dangerous unicode characters detected and removed',
          severity: 'medium',
          pattern: pattern.source,
        });
        result = result.replace(pattern, '');
      }
    }
    
    return result;
  }
  
  /**
   * Detect injection attempts
   */
  private detectInjection(
    input: string,
    context: ValidationContext
  ): {
    sanitized: string;
    warnings: ValidationWarning[];
    blocked: boolean;
    blockReason?: string;
  } {
    const warnings: ValidationWarning[] = [];
    let sanitized = input;
    let blocked = false;
    let blockReason: string | undefined;
    
    for (const { name, pattern, severity, block } of INJECTION_PATTERNS) {
      const matches = input.match(pattern);
      
      if (matches) {
        warnings.push({
          code: `INJECTION_${name.toUpperCase()}`,
          message: `Potential ${name.replace(/_/g, ' ')} detected`,
          severity,
          pattern: pattern.source,
        });
        
        if (block) {
          blocked = true;
          blockReason = `Blocked: ${name.replace(/_/g, ' ')} detected`;
          
          this.getLogger().warn('Injection attempt blocked', {
            ...context,
            injectionType: name,
            pattern: pattern.source,
          });
        } else {
          // Sanitize by escaping the pattern
          sanitized = sanitized.replace(pattern, (match) => {
            // HTML-encode the matched content
            return match
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#x27;');
          });
        }
      }
    }
    
    return { sanitized, warnings, blocked, blockReason };
  }
  
  /**
   * Validate file content (with additional checks)
   */
  validateFileContent(
    content: Buffer,
    filename: string,
    context: ValidationContext = {}
  ): ValidationResult & { mimeType?: string } {
    // Check file size
    if (content.length > this.config.maxFileSize) {
      return {
        valid: false,
        sanitized: '',
        warnings: [{
          code: 'FILE_SIZE_EXCEEDED',
          message: `File exceeds maximum size of ${this.config.maxFileSize} bytes`,
          severity: 'high',
        }],
        blocked: true,
        blockReason: 'File size exceeds limit',
      };
    }
    
    // Check for null bytes in filename
    if (filename.includes('\0')) {
      return {
        valid: false,
        sanitized: '',
        warnings: [{
          code: 'FILENAME_NULL_BYTE',
          message: 'Filename contains null bytes',
          severity: 'high',
        }],
        blocked: true,
        blockReason: 'Invalid filename',
      };
    }
    
    // Check for path traversal in filename
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return {
        valid: false,
        sanitized: '',
        warnings: [{
          code: 'FILENAME_PATH_TRAVERSAL',
          message: 'Filename contains path traversal characters',
          severity: 'high',
        }],
        blocked: true,
        blockReason: 'Invalid filename',
      };
    }
    
    // Try to validate as text if it looks like text
    const textContent = content.toString('utf-8');
    if (this.isLikelyText(content)) {
      return this.validate(textContent, context);
    }
    
    // Binary content - just check for suspicious patterns
    return {
      valid: true,
      sanitized: '', // Don't return binary as string
      warnings: [],
      blocked: false,
    };
  }
  
  /**
   * Check if content is likely text
   */
  private isLikelyText(content: Buffer): boolean {
    // Check first 8KB for null bytes (binary indicator)
    const sample = content.subarray(0, 8192);
    const nullCount = sample.filter(b => b === 0).length;
    
    // If more than 1% null bytes, likely binary
    return nullCount < sample.length * 0.01;
  }
}

/**
 * Create a validator instance from config
 */
export function createValidator(config: SecurityConfig): InputValidator {
  return new InputValidator(config.inputValidation);
}
