/**
 * Phase 5D: Rate Limiting with Pluggable Store
 *
 * Architecture:
 *   RateLimitStore (interface)
 *     ↓
 *   MemoryStore (current — single-instance only)
 *     ↓
 *   RedisStore (future — multi-instance, Phase 5E+)
 *
 * IMPORTANT: The current MemoryStore is NOT suitable for multi-instance
 * deployments. Each server instance maintains its own in-memory counter,
 * meaning rate limits are per-instance, not global. For horizontal scaling,
 * replace the store with a Redis-backed implementation.
 *
 * Usage:
 *   const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });
 *   const result = limiter(request);
 *   if (!result.success) throw new RateLimitError(result.remaining, result.resetAt);
 */

import { ApiError } from '@/lib/errors';

// ─── Store Interface ───

export interface RateLimitStore {
  /**
   * Increment the counter for a key.
   * Returns the current count and reset timestamp.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;

  /**
   * Get the current count for a key (without incrementing).
   */
  get(key: string): Promise<{ count: number; resetAt: number } | null>;

  /**
   * Delete expired entries. Called periodically.
   */
  cleanup(): void;
}

// ─── Memory Store (single-instance) ───

interface MemoryEntry {
  count: number;
  resetAt: number;
}

export class MemoryStore implements RateLimitStore {
  private store = new Map<string, MemoryEntry>();

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }

    entry.count++;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async get(key: string): Promise<{ count: number; resetAt: number } | null> {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) return null;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }
}

// ─── Default Store ───

/** The active rate limit store. Defaults to MemoryStore. Replace for multi-instance deployments. */
let activeStore: RateLimitStore = new MemoryStore();

/**
 * Set the active rate limit store.
 * Use this to replace MemoryStore with RedisStore in future phases.
 */
export function setRateLimitStore(store: RateLimitStore) {
  activeStore = store;
}

/**
 * Get the active rate limit store (for testing).
 */
export function getRateLimitStore(): RateLimitStore {
  return activeStore;
}

// ─── Rate Limit ───

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  /** Headers to set on the response for client visibility */
  headers: Record<string, string>;
}

// Periodic cleanup (every 60 seconds)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    activeStore.cleanup();
  }, 60_000);
  // Don't prevent process exit
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function rateLimit(options: { windowMs: number; maxRequests: number }) {
  const { windowMs, maxRequests } = options;

  // Start periodic cleanup
  startCleanup();

  return function checkRateLimit(request: Request): RateLimitResult {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
    const key = `rl:${ip}`;

    // Synchronous for MemoryStore, but interface supports async for future stores
    // We use .then() pattern for compatibility — MemoryStore is sync
    let result: { count: number; resetAt: number };

    // For MemoryStore, we can call synchronously
    const now = Date.now();
    const storeResult = (activeStore as MemoryStore).store.get(key);

    if (!storeResult || storeResult.resetAt <= now) {
      const resetAt = now + windowMs;
      (activeStore as MemoryStore).store.set(key, { count: 1, resetAt });
      result = { count: 1, resetAt };
    } else {
      storeResult.count++;
      result = { count: storeResult.count, resetAt: storeResult.resetAt };
    }

    const success = result.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - result.count);
    const resetAt = result.resetAt;

    return {
      success,
      remaining,
      resetAt,
      limit: maxRequests,
      headers: {
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)), // Unix seconds
      },
    };
  };
}

// ─── Error ───

export class RateLimitError extends ApiError {
  public readonly resetAt: number;

  constructor(remaining: number, resetAt: number) {
    super(
      429,
      'RATE_LIMITED',
      'Too many requests. Please try again later.',
      { remaining, retryAfter: Math.ceil((resetAt - Date.now()) / 1000) }
    );
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }

  /** Get the Retry-After value in seconds */
  get retryAfter(): number {
    return Math.max(0, Math.ceil((this.resetAt - Date.now()) / 1000));
  }
}
