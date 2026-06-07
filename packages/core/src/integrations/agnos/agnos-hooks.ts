/**
 * AGNOS Integration Hooks
 *
 * Registers extension hooks that:
 * 1. Forward audit events to AGNOS audit subsystem
 * 2. Publish SecureYeoman lifecycle events to AGNOS pub/sub
 * 3. Subscribe to AGNOS events and wire them into the extension system
 */

import type { ExtensionManager } from '../../extensions/manager.js';
import type { HookPoint } from '../../extensions/types.js';
import type { SecureLogger } from '../../logging/logger.js';
import type { AgnosClient } from './agnos-client.js';

export interface AgnosHooksConfig {
  enabled: boolean;
  /** Forward audit events to AGNOS. Default: true when enabled. */
  forwardAudit?: boolean;
  /** Publish lifecycle events to AGNOS pub/sub. Default: true when enabled. */
  publishEvents?: boolean;
  /** Subscribe to AGNOS events. Default: true when enabled. */
  subscribeEvents?: boolean;
  /** AGNOS event topics to subscribe to. Default: ['agent.*', 'task.*'] */
  subscribeTopics?: string[];
  /** Hook points that trigger AGNOS event publish. */
  publishHookPoints?: string[];
  /** Max audit events to batch before flushing. Default: 50 */
  auditBatchSize?: number;
  /** Max ms to wait before flushing audit batch. Default: 5000 */
  auditFlushIntervalMs?: number;
}

export interface AgnosHooksDeps {
  extensionManager: ExtensionManager;
  agnosClient: AgnosClient;
  logger: SecureLogger;
}

/**
 * Registers extension hooks for AGNOS integration.
 * Returns an unregister/cleanup function to remove all hooks and stop SSE.
 */
export function registerAgnosHooks(config: AgnosHooksConfig, deps: AgnosHooksDeps): () => void {
  if (!config.enabled) {
    deps.logger.debug('AGNOS hooks disabled');
    return () => {};
  }

  const hookIds: string[] = [];
  const cleanupFns: (() => void)[] = [];

  // ── 1. Audit event forwarding ─────────────────────────────
  if (config.forwardAudit !== false) {
    const batchSize = config.auditBatchSize ?? 50;
    const flushInterval = config.auditFlushIntervalMs ?? 5000;
    const auditBuffer: Record<string, unknown>[] = [];

    const flush = async (): Promise<void> => {
      if (auditBuffer.length === 0) return;
      const batch = auditBuffer.splice(0, auditBuffer.length);
      try {
        await deps.agnosClient.forwardAuditEvents(batch);
        deps.logger.debug({ count: batch.length }, 'Forwarded audit events to AGNOS');
      } catch (err) {
        deps.logger.debug(
          { error: err instanceof Error ? err.message : String(err), count: batch.length },
          'Failed to forward audit events to AGNOS'
        );
      }
    };

    const timer = setInterval(() => {
      flush().catch(() => {});
    }, flushInterval);
    if (timer.unref) timer.unref();
    cleanupFns.push(() => {
      clearInterval(timer);
      flush().catch(() => {});
    });

    const auditHookPoints: HookPoint[] = [
      'security:auth-success',
      'security:auth-failure',
      'task:after-execute',
      'agent:after-delegate',
    ];

    for (const hookPoint of auditHookPoints) {
      const id = deps.extensionManager.registerHook(
        hookPoint,
        async (context) => {
          auditBuffer.push({
            event: context.event,
            timestamp: context.timestamp,
            data: context.data,
            source: 'secureyeoman',
          });
          if (auditBuffer.length >= batchSize) {
            flush().catch(() => {});
          }
          return { vetoed: false, errors: [] };
        },
        { priority: 300, semantics: 'observe', extensionId: 'agnos-audit-forward' }
      );
      hookIds.push(id);
    }

    deps.logger.info('AGNOS audit forwarding registered');
  }

  // ── 1b. Audit run record forwarding ─────────────────────
  if (config.forwardAudit !== false) {
    const auditRunPoints: HookPoint[] = ['swarm:after-execute', 'task:after-execute'];

    for (const hookPoint of auditRunPoints) {
      const id = deps.extensionManager.registerHook(
        hookPoint,
        async (context) => {
          try {
            const data = (
              typeof context.data === 'object' && context.data !== null ? context.data : {}
            ) as Record<string, unknown>;

            await deps.agnosClient.forwardAuditRun({
              run_id: (data.runId as string) ?? (data.swarmId as string) ?? `run-${Date.now()}`,
              playbook: (data.playbook as string) ?? context.event,
              success: (data.success as boolean) ?? true,
              tasks: (data.tasks as { name: string; status: string; duration_ms?: number }[]) ?? [
                { name: context.event, status: 'completed' },
              ],
              timestamp: new Date(context.timestamp).toISOString(),
            });
          } catch {
            // Non-fatal — audit run forwarding is best-effort
          }
          return { vetoed: false, errors: [] };
        },
        { priority: 290, semantics: 'observe', extensionId: 'agnos-audit-run-forward' }
      );
      hookIds.push(id);
    }

    deps.logger.info('AGNOS audit run forwarding registered');
  }

  // ── 2. Event publishing ────────────────────────────────────
  if (config.publishEvents !== false) {
    const publishPoints = config.publishHookPoints ?? [
      'swarm:after-execute',
      'task:after-execute',
      'agent:after-delegate',
      'system:error',
    ];

    for (const hookPoint of publishPoints) {
      const id = deps.extensionManager.registerHook(
        hookPoint as HookPoint,
        async (context) => {
          try {
            await deps.agnosClient.publishEvent(`secureyeoman.${context.event}`, {
              event: context.event,
              timestamp: context.timestamp,
              ...(typeof context.data === 'object' && context.data !== null
                ? (context.data as Record<string, unknown>)
                : { data: context.data }),
            });
          } catch {
            // Non-fatal — don't block SecureYeoman operations
          }
          return { vetoed: false, errors: [] };
        },
        { priority: 250, semantics: 'observe', extensionId: 'agnos-event-publish' }
      );
      hookIds.push(id);
    }

    deps.logger.info({ hookPoints: publishPoints }, 'AGNOS event publishing registered');
  }

  // ── 3. Event subscription ──────────────────────────────────
  if (config.subscribeEvents !== false) {
    const topics = config.subscribeTopics ?? ['agent.*', 'task.*'];
    const sseController = deps.agnosClient.subscribeEvents(topics, (event) => {
      deps.extensionManager
        .emit('system:startup', {
          event: `agnos:${event.topic}`,
          data: event.data,
          timestamp: Date.now(),
        })
        .catch(() => {});
    });
    cleanupFns.push(() => {
      sseController.abort();
    });

    deps.logger.info({ topics }, 'AGNOS event subscription started');
  }

  // ── Cleanup ────────────────────────────────────────────────
  return () => {
    for (const id of hookIds) {
      deps.extensionManager.unregisterHook(id);
    }
    for (const fn of cleanupFns) {
      fn();
    }
    deps.logger.debug('AGNOS hooks unregistered');
  };
}
