# Phase 5E Stage 3: Payment API Routes — Work Record

## Summary
Created all payment API route handlers that wire domain services to HTTP endpoints.

## Files Created

### Validation Schemas
- `src/lib/validations/payments.ts` — Zod schemas for all payment endpoints
- Updated `src/lib/validations/index.ts` — Re-exported all new schemas and types

### API Routes
1. **`src/app/api/payments/route.ts`** — `GET` List payments (ORGANIZER/SUPER_ADMIN, paginated, filtered)
2. **`src/app/api/payments/initialize/route.ts`** — `POST` Initialize payment (booking owner, rate 10/min)
3. **`src/app/api/payments/[id]/route.ts`** — `GET` Single payment status (booking owner/SUPER_ADMIN)
4. **`src/app/api/payments/[id]/verify/route.ts`** — `POST` Server-side verify (booking owner, rate 5/min)
5. **`src/app/api/payments/[id]/confirm-manual/route.ts`** — `POST` Manual confirm (ORGANIZER/SUPER_ADMIN, rate 5/min)
6. **`src/app/api/payments/[id]/attempts/route.ts`** — `GET` Payment attempts (booking owner/SUPER_ADMIN)
7. **`src/app/api/payments/[id]/refunds/route.ts`** — `GET` List refunds + `POST` Request refund (rate 3/min)
8. **`src/app/api/payments/expiry-sweep/route.ts`** — `POST` Expire eligible payments (SUPER_ADMIN only, rate 2/min)
9. **`src/app/api/refunds/[id]/route.ts`** — `GET` Single refund status (booking owner/SUPER_ADMIN)
10. **`src/app/api/webhooks/paystack/route.ts`** — `POST` Paystack webhook (no auth, HMAC-SHA512 signature verification, rate 100/min)

## Key Design Decisions

1. **Route handler pattern**: All routes follow the existing project convention — rate limit → authenticate → validate → business logic → response
2. **Dynamic params**: All `[id]` routes use `await params` per Next.js 15+ async params requirement
3. **ProviderIntegrationPending**: PAYSTACK provider calls return 501 with clear error when integration is pending
4. **Webhook endpoint**: No `authenticate()` — verifies HMAC-SHA512 signature instead. Always returns `{ received: true }` after signature verification to prevent retries
5. **Authorization**: ORGANIZER sees only their events' payments; SUPER_ADMIN sees all
6. **Manual confirm**: Only for MANUAL provider payments, requires event organizer or SUPER_ADMIN
7. **Refund**: Rate limited to 3 req/min; PAYSTACK provider refund returns 501 if integration pending

## Environment
- `PAYSTACK_WEBHOOK_SECRET` was already defined in `src/lib/env.ts` — no changes needed

## Verification
- ESLint: No new errors (existing server-keeper.js errors are pre-existing)
- TypeScript: No new type errors in any of the created files
- Dev server: Running cleanly with no compilation errors
