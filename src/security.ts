import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type ReplayDecision = { accepted: true; key: string } | { accepted: false; reason: 'stale' | 'replay' };

export class WebhookReplayGuard {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly windowMs = 5 * 60_000,
    private readonly maximumEntries = 1_000,
  ) {}

  reserve(rawBody: Buffer, eventTime: string, now = Date.now()): ReplayDecision {
    const timestamp = Date.parse(eventTime);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > this.windowMs)
      return { accepted: false, reason: 'stale' };
    this.prune(now);
    const key = createHash('sha256').update(rawBody).digest('hex');
    if (this.entries.has(key)) return { accepted: false, reason: 'replay' };
    while (this.entries.size >= this.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, now + this.windowMs);
    return { accepted: true, key };
  }

  release(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

export function verifyVikunjaSignature(
  rawBody: Buffer,
  suppliedSignature: string | undefined,
  secret: string,
): boolean {
  if (!suppliedSignature) return false;

  const normalizedSignature = suppliedSignature.startsWith('sha256=')
    ? suppliedSignature.slice('sha256='.length)
    : suppliedSignature;
  if (!/^[a-f\d]{64}$/i.test(normalizedSignature)) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(normalizedSignature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
