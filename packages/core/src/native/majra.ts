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
// Pure-TS fixed-window limiter (the NAPI majra binding is gone; the TS edge of
// the code still routes rate-limit decisions through this module, so it has to
// actually limit). Rust sy-core has its own native limiter.

interface RateRule {
  windowMs: number;
  maxRequests: number;
}

interface RateBucket {
  count: number;
  windowStart: number;
  lastAccess: number;
}

const rateRules = new Map<string, RateRule>();
const rateBuckets = new Map<string, Map<string, RateBucket>>();

export function ratelimitRegister(
  ruleName: string,
  windowMs: number,
  maxRequests: number
): void {
  rateRules.set(ruleName, { windowMs, maxRequests });
  // Re-registering a rule clears its buckets — per-instance limiters expect a
  // fresh state in their constructor, and without clearing, bucket state leaks
  // across consecutive `new RateLimiter()` calls (e.g. between tests).
  rateBuckets.set(ruleName, new Map());
}

export function ratelimitCheck(ruleName: string, key: string): { allowed: boolean } {
  const rule = rateRules.get(ruleName);
  if (!rule) return { allowed: true };
  const buckets = rateBuckets.get(ruleName)!;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= rule.windowMs) {
    bucket = { count: 0, windowStart: now, lastAccess: now };
    buckets.set(key, bucket);
  }
  bucket.lastAccess = now;
  if (bucket.count >= rule.maxRequests) return { allowed: false };
  bucket.count++;
  return { allowed: true };
}

export function ratelimitResetKey(ruleName: string, key: string): void {
  rateBuckets.get(ruleName)?.delete(key);
}

export function ratelimitEvict(ruleName: string, maxIdleMs: number): number {
  const buckets = rateBuckets.get(ruleName);
  if (!buckets) return 0;
  const now = Date.now();
  let evicted = 0;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastAccess >= maxIdleMs) {
      buckets.delete(key);
      evicted++;
    }
  }
  return evicted;
}

export function ratelimitStats(_ruleName: string): string | null {
  return null;
}

export function ratelimitRemove(ruleName: string): boolean {
  const existed = rateRules.delete(ruleName);
  rateBuckets.delete(ruleName);
  return existed;
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
