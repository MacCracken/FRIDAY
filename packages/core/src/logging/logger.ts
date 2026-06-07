/**
 * Secure Logger for SecureYeoman
 *
 * Security considerations:
 * - Automatic secret redaction in log output
 * - Structured JSON format for machine parsing
 * - Correlation ID propagation for tracing
 * - No console.log - all output through pino
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { sanitizeForLogging } from '../utils/crypto.js';
import type { LoggingConfig } from '@secureyeoman/shared';
import { getCurrentTraceId } from '../telemetry/otel.js';
import { getCurrentSpanId } from '../telemetry/instrument.js';
import { getCorrelationId } from '../utils/correlation-context.js';

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
  trace(context: LogContext, msg: string): void;
  debug(msg: string, context?: LogContext): void;
  debug(context: LogContext, msg: string): void;
  info(msg: string, context?: LogContext): void;
  info(context: LogContext, msg: string): void;
  warn(msg: string, context?: LogContext): void;
  warn(context: LogContext, msg: string): void;
  error(msg: string, context?: LogContext): void;
  error(context: LogContext, msg: string): void;
  fatal(msg: string, context?: LogContext): void;
  fatal(context: LogContext, msg: string): void;
  child(context: LogContext): SecureLogger;
  level: LogLevel;
}

/**
 * Create pino logger options from config
 */
function createPinoOptions(config: LoggingConfig): LoggerOptions {
  const logFormat = process.env.LOG_FORMAT;
  const isEcs = logFormat === 'ecs';

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
    formatters: isEcs
      ? {
          level: (label) => ({ 'log.level': label }),
          bindings: (bindings) => ({
            'service.name': 'secureyeoman',
            'process.pid': bindings.pid,
            'host.hostname': bindings.hostname,
          }),
          log: (obj) => ({
            ...obj,
            '@timestamp': new Date().toISOString(),
            'trace.id': getCurrentTraceId() ?? undefined,
            'span.id': getCurrentSpanId() ?? undefined,
            'transaction.id': getCorrelationId() ?? undefined,
          }),
        }
      : {
          level: (label) => ({ level: label }),
          bindings: (bindings) => ({
            pid: bindings.pid,
            hostname: bindings.hostname,
            name: 'secureyeoman',
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
 * Create transport configuration based on output settings.
 *
 * JSON stdout is intentionally NOT handled via a pino transport: pino's
 * transport API spawns a worker thread (thread-stream) that dynamically
 * requires modules at runtime.  In a Bun compiled standalone binary there
 * are no node_modules, so any worker-based transport will throw
 * "ModuleNotFound".  pino(options) without a transport writes JSON to stdout
 * synchronously with no worker threads — that path is used when the only
 * configured output is json-stdout.
 *
 * pretty-stdout still uses pino-pretty (requires the package at runtime).
 * file outputs still use the pino/file transport.
 */
function createTransport(
  config: LoggingConfig
): pino.TransportMultiOptions | pino.TransportSingleOptions | undefined {
  // In a Bun compiled binary, pino transports (which use worker_threads to
  // dynamically require modules) will crash because the modules live in the
  // virtual FS and cannot be resolved.  Fall back to native JSON stdout.
  const isBunBinary = import.meta.url.includes('/$bunfs/');

  const targets: pino.TransportTargetOptions[] = [];

  for (const output of config.output) {
    if (output.type === 'stdout') {
      if (output.format === 'pretty' && !isBunBinary) {
        targets.push({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
          level: config.level,
        });
      }
      // json stdout: pino(options) writes JSON to fd 1 natively — no transport needed.
    } else if (output.type === 'file' && !isBunBinary) {
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
 * Resolve log arguments to (context, message) regardless of call order.
 * Supports both: logger.info('msg', {ctx}) and logger.info({ctx}, 'msg')
 */
function resolveLogArgs(
  a: string | LogContext,
  b?: LogContext | string
): [LogContext | undefined, string] {
  if (typeof a === 'string') {
    // Old pattern: logger.info('msg', {ctx})
    return [b as LogContext | undefined, a];
  }
  // Pino pattern: logger.info({ctx}, 'msg')
  return [a, typeof b === 'string' ? b : ''];
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

  trace(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    if (this.pino.isLevelEnabled('trace')) {
      const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
      this.pino.trace(this.sanitizeContext(ctx), msg);
    }
  }

  debug(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    if (this.pino.isLevelEnabled('debug')) {
      const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
      this.pino.debug(this.sanitizeContext(ctx), msg);
    }
  }

  info(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
    this.pino.info(this.sanitizeContext(ctx), msg);
  }

  warn(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
    this.pino.warn(this.sanitizeContext(ctx), msg);
  }

  error(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
    this.pino.error(this.sanitizeContext(ctx), msg);
  }

  fatal(msgOrCtx: string | LogContext, ctxOrMsg?: LogContext | string): void {
    const [ctx, msg] = resolveLogArgs(msgOrCtx, ctxOrMsg);
    this.pino.fatal(this.sanitizeContext(ctx), msg);
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

/**
 * Create a no-op logger that silently discards all messages.
 * Useful as a fallback when the global logger is not yet initialized.
 */
export function createNoopLogger(): SecureLogger {
  const noop: SecureLogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => noop,
    level: 'info',
  };
  return noop;
}
