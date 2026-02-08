/**
 * Secure Logger for SecureClaw
 *
 * Security considerations:
 * - Automatic secret redaction in log output
 * - Structured JSON format for machine parsing
 * - Correlation ID propagation for tracing
 * - No console.log - all output through pino
 */
import pino from 'pino';
import { sanitizeForLogging } from '../utils/crypto.js';
/**
 * Create pino logger options from config
 */
function createPinoOptions(config) {
    const options = {
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
function createTransport(config) {
    const targets = [];
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
            }
            else {
                targets.push({
                    target: 'pino/file',
                    options: { destination: 1 }, // stdout
                    level: config.level,
                });
            }
        }
        else if (output.type === 'file') {
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
class SecureLoggerImpl {
    pino;
    defaultContext;
    constructor(pino, defaultContext = {}) {
        this.pino = pino;
        this.defaultContext = defaultContext;
    }
    get level() {
        return this.pino.level;
    }
    sanitizeContext(context) {
        const merged = { ...this.defaultContext, ...context };
        return sanitizeForLogging(merged);
    }
    trace(msg, context) {
        this.pino.trace(this.sanitizeContext(context), msg);
    }
    debug(msg, context) {
        this.pino.debug(this.sanitizeContext(context), msg);
    }
    info(msg, context) {
        this.pino.info(this.sanitizeContext(context), msg);
    }
    warn(msg, context) {
        this.pino.warn(this.sanitizeContext(context), msg);
    }
    error(msg, context) {
        this.pino.error(this.sanitizeContext(context), msg);
    }
    fatal(msg, context) {
        this.pino.fatal(this.sanitizeContext(context), msg);
    }
    child(context) {
        const mergedContext = { ...this.defaultContext, ...context };
        return new SecureLoggerImpl(this.pino.child({}), mergedContext);
    }
}
/**
 * Create a secure logger instance
 */
export function createLogger(config) {
    const options = createPinoOptions(config);
    const transport = createTransport(config);
    let pinoLogger;
    if (transport) {
        pinoLogger = pino(options, pino.transport(transport));
    }
    else {
        pinoLogger = pino(options);
    }
    return new SecureLoggerImpl(pinoLogger);
}
/**
 * Global logger instance (set during initialization)
 */
let globalLogger = null;
/**
 * Initialize the global logger
 */
export function initializeLogger(config) {
    globalLogger = createLogger(config);
    return globalLogger;
}
/**
 * Get the global logger instance
 * Throws if not initialized
 */
export function getLogger() {
    if (!globalLogger) {
        throw new Error('Logger not initialized. Call initializeLogger() first.');
    }
    return globalLogger;
}
/**
 * Check if logger is initialized
 */
export function isLoggerInitialized() {
    return globalLogger !== null;
}
//# sourceMappingURL=logger.js.map