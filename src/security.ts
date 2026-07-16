import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyVikunjaSignature(rawBody: Buffer, suppliedSignature: string | undefined, secret: string): boolean {
  if (!suppliedSignature) return false;

  const normalizedSignature = suppliedSignature.startsWith('sha256=')
    ? suppliedSignature.slice('sha256='.length)
    : suppliedSignature;
  if (!/^[a-f\d]{64}$/i.test(normalizedSignature)) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(normalizedSignature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
