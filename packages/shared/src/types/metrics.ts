/**
 * Metrics Types for SecureYeoman
 * 
 * Security considerations:
 * - Metrics should never contain sensitive data
 * - All numeric values are validated for reasonable ranges
 * - Timestamps prevent replay attacks in metric reporting
 */

import { z } from 'zod';
import { TaskStatusSchema, TaskTypeSchema } from './task.js';
import { SeveritySchema, SecurityEventTypeSchema } from './security.js';

// Task execution metrics
export const TaskMetricsSchema = z.object({
  // Counters
  total: z.number().int().nonnegative(),
  byStatus: z.record(TaskStatusSchema, z.number().int().nonnegative()),
  byType: z.record(TaskTypeSchema, z.number().int().nonnegative()),
  
  // Rates
  successRate: z.number().min(0).max(1),
  failureRate: z.number().min(0).max(1),
  
  // Duration statistics (ms)
  avgDurationMs: z.number().nonnegative(),
  minDurationMs: z.number().nonnegative(),
  maxDurationMs: z.number().nonnegative(),
  p50DurationMs: z.number().nonnegative(),
  p95DurationMs: z.number().nonnegative(),
  p99DurationMs: z.number().nonnegative(),
  
  // Queue metrics
  queueDepth: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
});

export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;

// Resource usage metrics
export const ResourceMetricsSchema = z.object({
  // System resources
  cpuPercent: z.number().min(0).max(100),
  memoryUsedMb: z.number().nonnegative(),
  memoryLimitMb: z.number().nonnegative(),
  memoryPercent: z.number().min(0).max(100),
  
  // Disk usage
  diskUsedMb: z.number().nonnegative(),
  diskLimitMb: z.number().nonnegative().optional(),
  
  // Token usage
  tokensUsedToday: z.number().int().nonnegative(),
  tokensLimitDaily: z.number().int().nonnegative().optional(),
  tokensCachedToday: z.number().int().nonnegative(),
  
  // Cost tracking
  costUsdToday: z.number().nonnegative(),
  costUsdMonth: z.number().nonnegative(),
  
  // API metrics
  apiCallsTotal: z.number().int().nonnegative(),
  apiErrorsTotal: z.number().int().nonnegative(),
  apiLatencyAvgMs: z.number().nonnegative(),
});

export type ResourceMetrics = z.infer<typeof ResourceMetricsSchema>;

// Security metrics
export const SecurityMetricsSchema = z.object({
  // Authentication
  authAttemptsTotal: z.number().int().nonnegative(),
  authSuccessTotal: z.number().int().nonnegative(),
  authFailuresTotal: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  
  // Authorization
  permissionChecksTotal: z.number().int().nonnegative(),
  permissionDenialsTotal: z.number().int().nonnegative(),
  
  // Threats
  blockedRequestsTotal: z.number().int().nonnegative(),
  rateLimitHitsTotal: z.number().int().nonnegative(),
  injectionAttemptsTotal: z.number().int().nonnegative(),
  
  // Events by severity
  eventsBySeverity: z.record(SeveritySchema, z.number().int().nonnegative()),
  eventsByType: z.record(SecurityEventTypeSchema, z.number().int().nonnegative()),
  
  // Audit
  auditEntriesTotal: z.number().int().nonnegative(),
  auditChainValid: z.boolean(),
  lastAuditVerification: z.number().int().positive().optional(),
});

export type SecurityMetrics = z.infer<typeof SecurityMetricsSchema>;

// Combined metrics snapshot
export const MetricsSnapshotSchema = z.object({
  timestamp: z.number().int().positive(),
  tasks: TaskMetricsSchema,
  resources: ResourceMetricsSchema,
  security: SecurityMetricsSchema,
});

export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

// Time series data point
export const TimeSeriesPointSchema = z.object({
  timestamp: z.number().int().positive(),
  value: z.number(),
});

export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

// Time series with metadata
export const TimeSeriesSchema = z.object({
  name: z.string(),
  unit: z.string().optional(),
  points: z.array(TimeSeriesPointSchema),
});

export type TimeSeries = z.infer<typeof TimeSeriesSchema>;

// Metrics query parameters
export const MetricsQuerySchema = z.object({
  category: z.enum(['tasks', 'resources', 'security', 'all']).default('all'),
  timeRange: z.enum(['1h', '6h', '24h', '7d', '30d']).default('1h'),
  startTime: z.number().int().positive().optional(),
  endTime: z.number().int().positive().optional(),
  resolution: z.enum(['1m', '5m', '15m', '1h', '1d']).optional(),
});

export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
