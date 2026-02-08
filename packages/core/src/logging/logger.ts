/**
 * Secure Logger for SecureClaw
 * 
 * Security considerations:
 * - Automatic secret redaction in log output
 * - Structured JSON format for machine parsing
 * - Correlation ID propagation for tracing
 * - No console.log - all output through pino
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { sanitizeForLogging } from '../utils/crypto.js';
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
 * Create pino logger options from config
 */
function createPinoOptions(config: LoggingConfig): LoggerOptions {
  const options: LoggerOptions = {
    level: config.level,
    
    // Custom serializers for security
    serializers: {
      // Sanitize all object fields
      req: (req) => sanitizeForLogging(req),
      res: (res) => sanitizeForLogging(res),
      err: pino.stdSerializers.err,
    },
    
    // Add timestamp in ISO format
    timestamp: pino.stdTimeFunctions.isoTime,
    
    // Format error objects properly
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings['pid'],
        hostname: bindings['hostname'],
        name: 'secureclaw',
      }),
    },
    
    // Redact sensitive fields
    redact: {
      paths: [
        'password',
        'secret',
        'token',
        'apiKey',
        'api_key',
        'authorization',
        'Authorization',
        'cookie',
        'Cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
        '*.api_key',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  };
  
  return options;
}

/**
 * Create transport configuration based on output settings
 */
function createTransport(config: LoggingConfig): pino.TransportMultiOptions | pino.TransportSingleOptions | undefined {
  const targets: pino.TransportTargetOptions[] = [];
  
  for (const output of config.output) {
    if (output.type === 'stdout') {
      if (output.format === 'pretty') {
        targets.push({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
          level: config.level,
        });
      } else {
        targets.push({
          target: 'pino/file',
          options: { destination: 1 }, // stdout
          level: config.level,
        });
      }
    } else if (output.type === 'file') {
      targets.push({
        target: 'pino/file',
        options: { 
          destination: output.path,
          mkdir: true,
        },
        level: config.level,
      });
    }
  }
  
  if (targets.length === 0) {
    return undefined;
  }
  
  if (targets.length === 1) {
    return targets[0];
  }
  
  return { targets };
}

/**
 * Wrapper around pino that adds security features
 */
class SecureLoggerImpl implements SecureLogger {
  private readonly pino: PinoLogger;
  private readonly defaultContext: LogContext;
  
  constructor(pino: PinoLogger, defaultContext: LogContext = {}) {
    this.pino = pino;
    this.defaultContext = defaultContext;
  }
  
  get level(): LogLevel {
    return this.pino.level as LogLevel;
  }
  
  private sanitizeContext(context?: LogContext): Record<string, unknown> {
    const merged = { ...this.defaultContext, ...context };
    return sanitizeForLogging(merged) as Record<string, unknown>;
  }
  
  trace(msg: string, context?: LogContext): void {
    this.pino.trace(this.sanitizeContext(context), msg);
  }
  
  debug(msg: string, context?: LogContext): void {
    this.pino.debug(this.sanitizeContext(context), msg);
  }
  
  info(msg: string, context?: LogContext): void {
    this.pino.info(this.sanitizeContext(context), msg);
  }
  
  warn(msg: string, context?: LogContext): void {
    this.pino.warn(this.sanitizeContext(context), msg);
  }
  
  error(msg: string, context?: LogContext): void {
    this.pino.error(this.sanitizeContext(context), msg);
  }
  
  fatal(msg: string, context?: LogContext): void {
    this.pino.fatal(this.sanitizeContext(context), msg);
  }
  
  child(context: LogContext): SecureLogger {
    const mergedContext = { ...this.defaultContext, ...context };
    return new SecureLoggerImpl(this.pino.child({}), mergedContext);
  }
}

/**
 * Create a secure logger instance
 */
export function createLogger(config: LoggingConfig): SecureLogger {
  const options = createPinoOptions(config);
  const transport = createTransport(config);
  
  let pinoLogger: PinoLogger;
  
  if (transport) {
    pinoLogger = pino(options, pino.transport(transport));
  } else {
    pinoLogger = pino(options);
  }
  
  return new SecureLoggerImpl(pinoLogger);
}

/**
 * Global logger instance (set during initialization)
 */
let globalLogger: SecureLogger | null = null;

/**
 * Initialize the global logger
 */
export function initializeLogger(config: LoggingConfig): SecureLogger {
  globalLogger = createLogger(config);
  return globalLogger;
}

/**
 * Get the global logger instance
 * Throws if not initialized
 */
export function getLogger(): SecureLogger {
  if (!globalLogger) {
    throw new Error('Logger not initialized. Call initializeLogger() first.');
  }
  return globalLogger;
}

/**
 * Check if logger is initialized
 */
export function isLoggerInitialized(): boolean {
  return globalLogger !== null;
}
