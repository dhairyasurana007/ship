import { describe, it, expect } from 'vitest';
import { TokenBucketLimiter } from './TokenBucketLimiter.js';

describe('TokenBucketLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = new TokenBucketLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('app1').allowed).toBe(true);
    }
  });

  it('blocks the request that exceeds the limit', () => {
    const limiter = new TokenBucketLimiter(3);
    limiter.check('app2');
    limiter.check('app2');
    limiter.check('app2');
    const result = limiter.check('app2');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('sets correct limit and resetAt fields', () => {
    const limiter = new TokenBucketLimiter(10);
    const result = limiter.check('app3');
    expect(result.limit).toBe(10);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('buckets are per-key', () => {
    const limiter = new TokenBucketLimiter(1);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });
});
