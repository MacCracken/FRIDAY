/**
 * Task Types for SecureYeoman
 * 
 * Security considerations:
 * - All task types are strictly typed to prevent type confusion attacks
 * - Input/output are typed as unknown and must be validated before use
 * - Timestamps use numbers (Unix ms) to avoid Date serialization issues
 */

import { z } from 'zod';

// Task status enum - strict set of allowed values
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// Task type enum - categorizes task operations
export const TaskType = {
  EXECUTE: 'execute',
  QUERY: 'query',
  FILE: 'file',
  NETWORK: 'network',
  SYSTEM: 'system',
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

// Zod schemas for runtime validation
export const TaskStatusSchema = z.enum([
  'pending',
  'running', 
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export const TaskTypeSchema = z.enum([
  'execute',
  'query',
  'file',
  'network',
  'system',
]);

// Resource usage tracking
export const ResourceUsageSchema = z.object({
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    cached: z.number().int().nonnegative().default(0),
  }),
  memoryPeakMb: z.number().nonnegative(),
  cpuTimeMs: z.number().nonnegative(),
  networkBytes: z.object({
    sent: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
  }),
  apiCalls: z.array(z.object({
    provider: z.string(),
    endpoint: z.string(),
    count: z.number().int().positive(),
    costUsd: z.number().nonnegative().optional(),
  })),
});

export type ResourceUsage = z.infer<typeof ResourceUsageSchema>;

// Task error structure
export const TaskErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  // Stack trace stored separately, not inline for security
  stackTraceId: z.string().optional(),
  recoverable: z.boolean().default(false),
});

export type TaskError = z.infer<typeof TaskErrorSchema>;

// Security context for task execution
export const SecurityContextSchema = z.object({
  userId: z.string(),
  role: z.string(),
  permissionsUsed: z.array(z.string()),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().max(512).optional(),
});

export type SecurityContext = z.infer<typeof SecurityContextSchema>;

// Main task schema
export const TaskSchema = z.object({
  // Identification
  id: z.string().uuid(),
  correlationId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  
  // Task definition
  type: TaskTypeSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  
  // Input is validated separately - stored as hash for security
  inputHash: z.string().length(64), // SHA-256 hex
  
  // Status
  status: TaskStatusSchema,
  
  // Timing (Unix ms timestamps)
  createdAt: z.number().int().positive(),
  startedAt: z.number().int().positive().optional(),
  completedAt: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  
  // Timeout configuration
  timeoutMs: z.number().int().positive().default(300000), // 5 min default
  
  // Results
  result: z.object({
    success: z.boolean(),
    outputHash: z.string().length(64).optional(),
    error: TaskErrorSchema.optional(),
  }).optional(),
  
  // Resource tracking
  resources: ResourceUsageSchema.optional(),
  
  // Security context
  securityContext: SecurityContextSchema,
});

export type Task = z.infer<typeof TaskSchema>;

// Task creation input (subset for creating new tasks)
export const TaskCreateSchema = z.object({
  type: TaskTypeSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  input: z.unknown(), // Will be validated and hashed
  timeoutMs: z.number().int().positive().max(3600000).optional(), // Max 1 hour
  correlationId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;

// Task update (for status transitions)
export const TaskUpdateSchema = z.object({
  status: TaskStatusSchema.optional(),
  result: z.object({
    success: z.boolean(),
    outputHash: z.string().length(64).optional(),
    error: TaskErrorSchema.optional(),
  }).optional(),
  resources: ResourceUsageSchema.optional(),
});

export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
