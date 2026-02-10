/**
 * Shared Types - Main Export
 * 
 * Re-exports all shared types for convenient importing
 */

// Task types
export {
  TaskStatus,
  TaskType,
  TaskStatusSchema,
  TaskTypeSchema,
  ResourceUsageSchema,
  TaskErrorSchema,
  SecurityContextSchema,
  TaskSchema,
  TaskCreateSchema,
  TaskUpdateSchema,
  type ResourceUsage,
  type TaskError,
  type SecurityContext,
  type Task,
  type TaskCreate,
  type TaskUpdate,
} from './task.js';

// Security types
export {
  Severity,
  SecurityEventType,
  Role,
  SeveritySchema,
  SecurityEventTypeSchema,
  RoleSchema,
  SecurityEventSchema,
  PermissionSchema,
  RoleDefinitionSchema,
  AuditEntrySchema,
  RateLimitRuleSchema,
  TokenPayloadSchema,
  type SecurityEvent,
  type Permission,
  type RoleDefinition,
  type AuditEntry,
  type RateLimitRule,
  type TokenPayload,
} from './security.js';

// Metrics types
export {
  TaskMetricsSchema,
  ResourceMetricsSchema,
  SecurityMetricsSchema,
  MetricsSnapshotSchema,
  TimeSeriesPointSchema,
  TimeSeriesSchema,
  MetricsQuerySchema,
  type TaskMetrics,
  type ResourceMetrics,
  type SecurityMetrics,
  type MetricsSnapshot,
  type TimeSeriesPoint,
  type TimeSeries,
  type MetricsQuery,
} from './metrics.js';

// AI types
export {
  TokenUsageSchema,
  ToolParameterSchema,
  ToolSchema,
  ToolCallSchema,
  ToolResultSchema,
  AIMessageRoleSchema,
  AIMessageSchema,
  AIRequestSchema,
  StopReasonSchema,
  AIResponseSchema,
  AIStreamChunkSchema,
  AIProviderNameSchema,
  type TokenUsage,
  type ToolParameter,
  type Tool,
  type ToolCall,
  type ToolResult,
  type AIMessageRole,
  type AIMessage,
  type AIRequest,
  type StopReason,
  type AIResponse,
  type AIStreamChunk,
  type AIProviderName,
} from './ai.js';

// Soul types
export {
  PersonalitySchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  SkillSchema,
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillSourceSchema,
  SkillStatusSchema,
  LearningModeSchema,
  SoulConfigSchema,
  type Personality,
  type PersonalityCreate,
  type PersonalityUpdate,
  type Skill,
  type SkillCreate,
  type SkillUpdate,
  type SkillSource,
  type SkillStatus,
  type LearningMode,
  type SoulConfig,
} from './soul.js';

// Config types
export {
  CoreConfigSchema,
  SecurityConfigSchema,
  LoggingConfigSchema,
  MetricsConfigSchema,
  GatewayConfigSchema,
  ModelConfigSchema,
  ConfigSchema,
  PartialConfigSchema,
  type CoreConfig,
  type SecurityConfig,
  type LoggingConfig,
  type MetricsConfig,
  type GatewayConfig,
  type ModelConfig,
  type Config,
  type PartialConfig,
} from './config.js';
