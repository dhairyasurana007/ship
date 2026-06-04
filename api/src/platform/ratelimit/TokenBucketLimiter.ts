export interface IRateLimiter {
  check(key: string): { allowed: boolean; remaining: number; resetAt: number; limit: number };
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketLimiter implements IRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limitPerMin: number = 1000,
  ) {}

  check(key: string): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
    const now = Date.now();
    const windowStart = now - (now % 60_000);
    const resetAt = windowStart + 60_000;

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.lastRefill < windowStart) {
      bucket = { tokens: this.limitPerMin, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const allowed = bucket.tokens > 0;
    if (allowed) bucket.tokens -= 1;

    return { allowed, remaining: bucket.tokens, resetAt, limit: this.limitPerMin };
  }
}

export const rateLimiter = new TokenBucketLimiter();
