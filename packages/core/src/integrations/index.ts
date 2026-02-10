/**
 * Integration Module — Platform integrations and unified messaging.
 */

export { IntegrationStorage } from './storage.js';
export { IntegrationManager } from './manager.js';
export type { IntegrationManagerDeps } from './manager.js';
export { MessageRouter } from './message-router.js';
export type { MessageRouterDeps } from './message-router.js';
export { registerIntegrationRoutes } from './integration-routes.js';
export type { IntegrationRoutesOptions } from './integration-routes.js';
export type {
  Integration,
  PlatformAdapter,
  IntegrationDeps,
  IntegrationRegistryEntry,
} from './types.js';
