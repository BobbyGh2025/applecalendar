import { ApiError } from '@/lib/errors';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function rateLimit(options: { windowMs: number; maxRequests: number }) {
  const { windowMs, maxRequests } = options;

  return function checkRateLimit(request: Request): { success: boolean; remaining: number; resetAt: number } {
    cleanup();

    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
    const key = `rl:${ip}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      store.set(key, { count: 1, resetAt });
      return { success: true, remaining: maxRequests - 1, resetAt };
    }

    if (entry.count >= maxRequests) {
      return { success: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { success: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
  };
}

export class RateLimitError extends ApiError {
  constructor(remaining: number, resetAt: number) {
    super(
      429,
      'RATE_LIMITED',
      'Too many requests. Please try again later.',
      { remaining, resetAt }
    );
    this.name = 'RateLimitError';
  }
}
