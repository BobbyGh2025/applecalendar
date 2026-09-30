# Phase 5D Infrastructure — Tasks 10-13

## Summary
Implemented liveness probe, readiness probe, and rate-limit store abstraction with response headers.

## Files Created/Modified
- `src/app/api/health/route.ts` — Liveness endpoint (GET /api/health)
- `src/app/api/ready/route.ts` — Readiness endpoint (GET /api/ready, checks DB)
- `src/lib/rate-limit.ts` — Rewritten with RateLimitStore interface, MemoryStore, response headers, store swap functions

## Key Decisions
- Health endpoint does NOT check DB (lightweight liveness only)
- Ready endpoint checks DB via `$queryRaw\`SELECT 1\`` and returns per-check latency
- Rate limit store is pluggable via `setRateLimitStore()` for future Redis migration
- MemoryStore documented as single-instance only
- Periodic cleanup uses `.unref()` to not block process exit
- RateLimitResult includes X-RateLimit-Limit/Remaining/Reset headers

## Status: Complete
