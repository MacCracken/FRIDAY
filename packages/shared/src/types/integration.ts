/**
 * Integration Types for FRIDAY
 *
 * Platform integrations (Telegram, Discord, Slack, etc.) and unified messaging.
 * Follows the same Zod-schema-first pattern as soul.ts and task.ts.
 */

import { z } from 'zod';

// ─── Platform ────────────────────────────────────────────────

export const PlatformSchema = z.enum([
  'telegram',
  'discord',
  'slack',
  'github',
  'cli',
  'webhook',
  'imessage',
]);
export type Platform = z.infer<typeof PlatformSchema>;

// ─── Integration Status ──────────────────────────────────────

export const IntegrationStatusSchema = z.enum([
  'connected',
  'disconnected',
  'error',
  'configuring',
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

// ─── Integration Config ──────────────────────────────────────

export const IntegrationConfigSchema = z.object({
  id: z.string().min(1),
  platform: PlatformSchema,
  displayName: z.string().min(1).max(100),
  enabled: z.boolean().default(false),
  status: IntegrationStatusSchema.default('disconnected'),
  config: z.record(z.string(), z.unknown()).default({}),
  connectedAt: z.number().int().nonnegative().optional(),
  lastMessageAt: z.number().int().nonnegative().optional(),
  messageCount: z.number().int().nonnegative().default(0),
  errorMessage: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

export const IntegrationCreateSchema = IntegrationConfigSchema.omit({
  id: true,
  status: true,
  connectedAt: true,
  lastMessageAt: true,
  messageCount: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
});
export type IntegrationCreate = z.infer<typeof IntegrationCreateSchema>;

export const IntegrationUpdateSchema = IntegrationCreateSchema.partial();
export type IntegrationUpdate = z.infer<typeof IntegrationUpdateSchema>;

// ─── Unified Message ─────────────────────────────────────────

export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageAttachmentSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'file', 'location']),
  url: z.string().optional(),
  data: z.string().optional(), // base64 for inline
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const UnifiedMessageSchema = z.object({
  id: z.string().min(1),
  integrationId: z.string().min(1),
  platform: PlatformSchema,
  direction: MessageDirectionSchema,
  senderId: z.string().default(''),
  senderName: z.string().default(''),
  chatId: z.string().default(''),
  text: z.string().default(''),
  attachments: z.array(MessageAttachmentSchema).default([]),
  replyToMessageId: z.string().optional(),
  platformMessageId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.number().int().nonnegative(),
});
export type UnifiedMessage = z.infer<typeof UnifiedMessageSchema>;
