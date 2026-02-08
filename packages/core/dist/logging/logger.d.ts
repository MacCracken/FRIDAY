/**
 * Secure Logger for SecureClaw
 *
 * Security considerations:
 * - Automatic secret redaction in log output
 * - Structured JSON format for machine parsing
 * - Correlation ID propagation for tracing
 * - No console.log - all output through pino
 */
import type { LoggingConfig } from '@friday/shared';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LogContext {
    correlationId?: string;
    taskId?: string;
    userId?: string;
    component?: string;
    [key: string]: unknown;
}
export interface SecureLogger {
    trace(msg: string, context?: LogContext): void;
    debug(msg: string, context?: LogContext): void;
    info(msg: string, context?: LogContext): void;
    warn(msg: string, context?: LogContext): void;
    error(msg: string, context?: LogContext): void;
    fatal(msg: string, context?: LogContext): void;
    child(context: LogContext): SecureLogger;
    level: LogLevel;
}
/**
 * Create a secure logger instance
 */
export declare function createLogger(config: LoggingConfig): SecureLogger;
/**
 * Initialize the global logger
 */
export declare function initializeLogger(config: LoggingConfig): SecureLogger;
/**
 * Get the global logger instance
 * Throws if not initialized
 */
export declare function getLogger(): SecureLogger;
/**
 * Check if logger is initialized
 */
export declare function isLoggerInitialized(): boolean;
//# sourceMappingURL=logger.d.ts.map