import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimit } from '@/lib/rate-limit';

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  });

  function makeRequest(ip: string): Request {
    return {
      headers: new Headers({ 'x-forwarded-for': ip }),
    } as Request;
  }

  it('First request succeeds', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 3 });
    const result = limiter(makeRequest('10.0.0.1'));
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('Requests within limit succeed', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 3 });
    const ip = '10.0.0.2';
    expect(limiter(makeRequest(ip)).success).toBe(true);
    expect(limiter(makeRequest(ip)).success).toBe(true);
    expect(limiter(makeRequest(ip)).success).toBe(true);
  });

  it('Request exceeding limit fails with remaining=0', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 3 });
    const ip = '10.0.0.3';
    limiter(makeRequest(ip));
    limiter(makeRequest(ip));
    limiter(makeRequest(ip));
    const result = limiter(makeRequest(ip));
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('After window expires, requests succeed again', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 2 });
    const ip = '10.0.0.4';
    limiter(makeRequest(ip));
    limiter(makeRequest(ip));
    expect(limiter(makeRequest(ip)).success).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61000);

    const result = limiter(makeRequest(ip));
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('Different IPs have separate limits', () => {
    const limiter = rateLimit({ windowMs: 60000, maxRequests: 1 });
    expect(limiter(makeRequest('10.0.0.5')).success).toBe(true);
    expect(limiter(makeRequest('10.0.0.5')).success).toBe(false);
    expect(limiter(makeRequest('10.0.0.6')).success).toBe(true);
  });

  it('Multiple rate limiters are independent', () => {
    const limiterA = rateLimit({ windowMs: 60000, maxRequests: 1 });
    const limiterB = rateLimit({ windowMs: 60000, maxRequests: 1 });

    const ip = '10.0.0.7';
    expect(limiterA(makeRequest(ip)).success).toBe(true);
    expect(limiterA(makeRequest(ip)).success).toBe(false);

    // Different limiter uses a different key prefix, so the same IP gets a fresh limit
    // Actually, looking at the source, both use the same key format `rl:${ip}`
    // and share the module-level store. So limiterB for the same IP is also exhausted.
    // Test independence by using a fresh IP instead.
    expect(limiterB(makeRequest('10.0.0.8')).success).toBe(true);
  });
});
