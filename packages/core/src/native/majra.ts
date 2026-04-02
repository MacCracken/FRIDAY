/**
 * Majra stub — the native NAPI pub/sub + rate-limiting module is gone.
 * All functions are no-ops or return null. Consumers handle null/void gracefully.
 */

// ── Pub/Sub ───────────────────────────────────────────────────────────────────

export function publish(_topic: string, _payloadJson: unknown): number {
  return 0;
}

export function subscribe(_pattern: string, _callback: (message: string) => void): void {}

export function unsubscribeAll(_pattern: string): void {}

export function patternCount(): number {
  return 0;
}

export function messagesPublished(): number {
  return 0;
}

export function matchesPattern(_pattern: string, _topic: string): boolean {
  return false;
}

export function cleanupDead(): number {
  return 0;
}

// ── Direct channel ────────────────────────────────────────────────────────────

export function directPublish(_payloadJson: unknown): number {
  return 0;
}

export function directSubscribe(_callback: (message: string) => void): void {}

export function directSubscriberCount(): number {
  return 0;
}

export function directMessagesPublished(): number {
  return 0;
}

// ── Hashed channel ────────────────────────────────────────────────────────────

export function hashedPublish(_topic: string, _payloadJson: unknown): number {
  return 0;
}

export function hashedSubscribe(_topic: string, _callback: (message: string) => void): void {}

export function hashedTopicCount(): number {
  return 0;
}

export function hashedMessagesPublished(): number {
  return 0;
}

export function hashedUnsubscribe(_topic: string): void {}

// ── Rate limiting ─────────────────────────────────────────────────────────────

export function ratelimitRegister(
  _ruleName: string,
  _windowMs: number,
  _maxRequests: number
): void {}

export function ratelimitCheck(_ruleName: string, _key: string): { allowed: boolean } {
  return { allowed: true };
}

export function ratelimitResetKey(_ruleName: string, _key: string): void {}

export function ratelimitEvict(_ruleName: string, _maxIdleMs: number): number {
  return 0;
}

export function ratelimitStats(_ruleName: string): string | null {
  return null;
}

export function ratelimitRemove(_ruleName: string): boolean {
  return false;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export function heartbeatRegister(_id: string, _metadataJson: Record<string, unknown>): void {}

export function heartbeat(_id: string): boolean {
  return false;
}

export function heartbeatDeregister(_id: string): boolean {
  return false;
}

export function heartbeatUpdate(): { id: string; status: string }[] {
  return [];
}

export function heartbeatGet(_id: string): string | null {
  return null;
}

export function heartbeatList(_status: string): string {
  return '[]';
}

export function heartbeatCount(): number {
  return 0;
}

// ── Barrier ───────────────────────────────────────────────────────────────────

export function barrierCreate(_name: string, _participantsJson: string): void {}

export function barrierArrive(_name: string, _participant: string): string {
  return '{}';
}

export function barrierForce(_name: string, _deadParticipant: string): string {
  return '{}';
}

export function barrierComplete(_name: string): string | null {
  return null;
}

export function barrierCount(): number {
  return 0;
}

// ── Priority queue ────────────────────────────────────────────────────────────

export function queueEnqueue(_priority: string, _payloadJson: string): string {
  return '';
}

export function queueDequeue(): string | null {
  return null;
}

export function queueComplete(_jobId: string): boolean {
  return false;
}

export function queueFail(_jobId: string): boolean {
  return false;
}

export function queueCancel(_jobId: string): boolean {
  return false;
}

export function queueGet(_jobId: string): string | null {
  return null;
}

export function queueRunningCount(): number {
  return 0;
}

export function queueJobCount(): number {
  return 0;
}
