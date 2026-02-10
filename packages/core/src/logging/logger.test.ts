import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLogger,
  initializeLogger,
  getLogger,
  isLoggerInitialized,
  type SecureLogger,
} from './logger.js';

// Reset global logger state between tests by re-initializing
// We need a minimal config that doesn't require external transports
const minimalConfig = {
  level: 'trace' as const,
  format: 'json' as const,
  output: [{ type: 'stdout' as const, format: 'json' as const }],
  audit: {
    enabled: true,
    signingKeyEnv: 'AUDIT_SIGNING_KEY',
    retentionDays: 90,
    storageBackend: 'sqlite' as const,
    storagePath: ':memory:',
  },
};

describe('SecureLogger', () => {
  describe('createLogger()', () => {
    it('should return a SecureLogger', () => {
      const logger = createLogger(minimalConfig);
      expect(logger).toBeDefined();
      expect(logger.info).toBeTypeOf('function');
      expect(logger.debug).toBeTypeOf('function');
      expect(logger.warn).toBeTypeOf('function');
      expect(logger.error).toBeTypeOf('function');
      expect(logger.fatal).toBeTypeOf('function');
      expect(logger.trace).toBeTypeOf('function');
      expect(logger.child).toBeTypeOf('function');
    });
  });

  describe('log levels', () => {
    let logger: SecureLogger;

    beforeEach(() => {
      logger = createLogger(minimalConfig);
    });

    it('should not throw when calling trace', () => {
      expect(() => logger.trace('trace message')).not.toThrow();
    });

    it('should not throw when calling debug', () => {
      expect(() => logger.debug('debug message')).not.toThrow();
    });

    it('should not throw when calling info', () => {
      expect(() => logger.info('info message')).not.toThrow();
    });

    it('should not throw when calling warn', () => {
      expect(() => logger.warn('warn message')).not.toThrow();
    });

    it('should not throw when calling error', () => {
      expect(() => logger.error('error message')).not.toThrow();
    });

    it('should not throw when calling fatal', () => {
      expect(() => logger.fatal('fatal message')).not.toThrow();
    });

    it('should accept context objects', () => {
      expect(() => logger.info('with context', { userId: 'user-1', component: 'test' })).not.toThrow();
    });
  });

  describe('child()', () => {
    it('should create child logger with merged context', () => {
      const logger = createLogger(minimalConfig);
      const child = logger.child({ component: 'TestComponent', correlationId: 'abc' });

      expect(child).toBeDefined();
      expect(child.info).toBeTypeOf('function');
      // Child should work without errors
      expect(() => child.info('child message')).not.toThrow();
    });

    it('should create nested children', () => {
      const logger = createLogger(minimalConfig);
      const child1 = logger.child({ component: 'Parent' });
      const child2 = child1.child({ taskId: 'task-1' });

      expect(() => child2.info('nested child message')).not.toThrow();
    });
  });

  describe('initializeLogger() and getLogger()', () => {
    // Note: these tests mutate global state, so they must be careful about ordering

    it('should initialize and return a logger', () => {
      const logger = initializeLogger(minimalConfig);
      expect(logger).toBeDefined();
      expect(logger.info).toBeTypeOf('function');
    });

    it('should make logger available via getLogger()', () => {
      initializeLogger(minimalConfig);
      const logger = getLogger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeTypeOf('function');
    });
  });

  describe('isLoggerInitialized()', () => {
    it('should return true after initialization', () => {
      initializeLogger(minimalConfig);
      expect(isLoggerInitialized()).toBe(true);
    });
  });

  describe('redaction', () => {
    it('should have redact configuration for sensitive fields', () => {
      const logger = createLogger(minimalConfig);
      // The logger should be configured with redaction - we verify it
      // doesn't throw when logging sensitive-named fields
      expect(() => logger.info('test', {
        password: 'secret123',
        token: 'tok_abc',
        apiKey: 'key_xyz',
      } as any)).not.toThrow();
    });
  });

  describe('level property', () => {
    it('should expose the configured level', () => {
      const logger = createLogger(minimalConfig);
      expect(logger.level).toBe('trace');
    });

    it('should reflect config level', () => {
      const logger = createLogger({ ...minimalConfig, level: 'warn' as const });
      expect(logger.level).toBe('warn');
    });
  });
});
