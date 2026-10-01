# Phase 5E: Payment Domain Architecture — Inspection Findings & Implementation Plan

**Date:** 2025
**Phase:** 5E Implementation
**Status:** INSPECTION COMPLETE → PLAN READY

---

## PART 1: INSPECTION FINDINGS

### 1.1 Repository State

| Item | Value |
|------|-------|
| Git HEAD | `d38efe4` (latest) |
| Working tree | Clean (1 untracked tool-result file) |
| Prisma migrations | `0_baseline`, `1_money_constraints_postgresql` |
| Models in schema | 20 |
| Payment API routes | **NONE exist** |
| Payment services | **NONE exist** |
| `.env` Paystack vars | **NONE** (no PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY) |

### 1.2 Prisma Schema — Current State (CONFIRMED)

**Payment model (lines 441-466):**
- `method` → defaults to `"STRIPE"` — ❌ should be `provider` with default `"PAYSTACK"`
- `status` → only `"PENDING", "COMPLETED", "FAILED", "REFUNDED"` — ❌ missing `PROCESSING`, `EXPIRED`, `CANCELLED`
- `transactionId` → exists but unused
- `providerRef` → exists but unused
- `webhookEventId` → exists but unused
- `idempotencyKey` → exists (@unique) but **never used in booking route**
- `failureReason` → exists
- `refundedAmount` → exists (Int @default(0))
- `refundRef` → exists
- `metadata` → exists (String?, JSON)
- ❌ **Missing**: `expiresAt`, `cancelledAt`, `completedAt`, `failedAt`, `processedAt`

**TicketType model (lines 375-396):**
- `quantity` → total available ✅
- `soldCount` → default 0 ✅
- ❌ **Missing**: `reservedCount` — no separate reservation pool

**Booking model (lines 416-439):**
- `status` → defaults to `"PENDING"` ✅
- `cancellationReason`, `cancelledBy` → ✅
- ❌ **Missing**: `confirmedAt` timestamp
- ❌ **Missing**: `expiresAt` for payment timeout

**Missing models:**
- ❌ `PaymentAttempt` — retry/audit trail per payment
- ❌ `PaymentWebhookEvent` — dedup + audit for incoming webhooks
- ❌ `Refund` — full refund lifecycle with status machine

### 1.3 Booking Creation Route — CRITICAL BUGS CONFIRMED

**File:** `src/app/api/events/[id]/book/route.ts`

| Line | Bug | Severity | Exploit |
|------|-----|----------|---------|
| 127 | `status: 'CONFIRMED'` always — even for paid events | 🔴 CRITICAL | Free attendance: book paid event, never pay, get CONFIRMED booking |
| 154 | `status: 'VALID'` tickets issued immediately | 🔴 CRITICAL | Free tickets: get valid QR codes before paying |
| 139 | `method: totalAmount > 0 ? 'STRIPE' : 'FREE'` | 🟡 HIGH | Hardcoded STRIPE, should be PAYSTACK |
| 106-113 | Uses `soldCount` increment for all bookings | 🟡 HIGH | No inventory reservation — paid bookings consume sold inventory before payment |
| — | No `Idempotency-Key` header accepted | 🟡 HIGH | Duplicate bookings on network retry |
| — | No payment expiry mechanism | 🟡 HIGH | Inventory held forever if user abandons |
| 161 | Notification says "confirmed" for paid bookings | 🟠 MEDIUM | Misleading UX |

### 1.4 Booking Cancellation Route — GAPS CONFIRMED

**File:** `src/app/api/bookings/[id]/cancel/route.ts`

| Line | Gap | Severity |
|------|-----|----------|
| 48 | Only `CONFIRMED` bookings can be cancelled | 🟡 HIGH — PENDING bookings (paid, awaiting payment) cannot be cancelled |
| 110-128 | Restores `soldCount` not `reservedCount` | 🟡 HIGH — wrong counter for paid bookings |
| 142-145 | COMPLETED payments stay COMPLETED (no refund) | 🟡 HIGH — documented as intentional but refund workflow missing |
| — | No `expiresAt` cleanup | 🟠 MEDIUM |

### 1.5 Ticket Check-in Route — GAPS CONFIRMED

**File:** `src/app/api/tickets/[qrCode]/route.ts`

| Line | Gap | Severity |
|------|-----|----------|
| 115-125 | Only checks ticket status, NOT booking/payment status | 🔴 CRITICAL — VALID tickets for unpaid (PENDING) bookings can be checked in |

### 1.6 Validations — GAPS CONFIRMED

**File:** `src/lib/validations/common.ts`

| Line | Current | Required |
|------|---------|----------|
| 117 | `paymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']` | `['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']` |
| 114 | `bookingStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED']` | ✅ Already correct |

### 1.7 Money Utilities — CONFIRMED CORRECT ✅

- Integer minor-unit architecture fully implemented
- All arithmetic (add, subtract, multiply, percentage, platform fee) correct
- Branded `Money` type prevents accidental misuse
- Money constraints (`money-constraints.ts`) enforce non-negative + refunded ≤ amount
- No changes needed

### 1.8 Seed Data — GAPS

- Has paid booking with PENDING payment (evt-2) — ✅
- Has paid booking with COMPLETED payment (evt-1) — ✅
- Has free booking — ✅
- ❌ Missing: failed payment scenario
- ❌ Missing: refund scenario
- ❌ Missing: payment attempt records
- ❌ Missing: webhook event records
- ❌ Missing: PROCESSING/EXPIRED/CANCELLED payment statuses

### 1.9 Environment — GAPS

- ❌ No `PAYSTACK_SECRET_KEY`
- ❌ No `PAYSTACK_PUBLIC_KEY`
- ❌ No `PAYSTACK_WEBHOOK_SECRET`
- ❌ No `PAYSTACK_BASE_URL` (test vs live)
- ❌ No `PAYMENT_EXPIRY_MINUTES`

### 1.10 Existing Services — No Payment Services

| Service | Status |
|---------|--------|
| `payment-service.ts` | ❌ Does not exist |
| `booking-service.ts` | ❌ Does not exist |
| `ticket-service.ts` | ❌ Does not exist |
| `refund-service.ts` | ❌ Does not exist |
| `webhook-service.ts` | ❌ Does not exist |
| `reconciliation-service.ts` | ❌ Does not exist |
| `payment-provider.ts` | ❌ Does not exist |
| `paystack.ts` (provider) | ❌ Does not exist |

### 1.11 TypeScript Error Inventory (Pre-existing)

| Category | Count | Details |
|----------|-------|---------|
| Non-app code | 6 | examples, skills, missing dep |
| Test code | 4 | NODE_ENV readonly |
| Pre-existing app | 11 | 2 production-crash, 4 logic-bugs, 5 cosmetic |
| Phase 5D-introduced | 4 | 2 env.ts, 2 rate-limit.ts |
| **Phase 5E must NOT add new errors** | | |

---

## PART 2: IMPLEMENTATION PLAN

### Architecture Overview

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend   │────▶│   API Routes     │────▶│   Services      │
│  (booking    │     │ (initialize,     │     │ (payment-state, │
│   flow)      │     │  callback,       │     │  booking,       │
│              │     │  webhook,        │     │  ticket,        │
│              │     │  verify,         │     │  refund,        │
│              │     │  refund)         │     │  webhook)       │
└──────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  Provider Layer  │
                                              │ (Paystack,       │
                                              │  Manual)         │
                                              └─────────────────┘
```

### State Machines

**Payment State Machine:**
```
PENDING ──▶ PROCESSING ──▶ COMPLETED
  │             │              │
  │             ▼              ▼
  │          FAILED        REFUNDED
  ▼
CANCELLED (by user/expiry)
  │
  ▼
EXPIRED (timeout)
```

**Booking State Machine:**
```
PENDING ──▶ CONFIRMED (on payment COMPLETED or free event)
  │             │
  ▼             ▼
CANCELLED    REFUNDED
```

**Refund State Machine:**
```
REQUESTED ──▶ PROCESSING ──▶ COMPLETED
                  │
                  ▼
               FAILED
```

### Implementation Sequence (Ordered by Dependency)

#### STAGE 1: Foundation (Schema + Core Types)

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 1 | S1-1 | Update Prisma schema | `prisma/schema.prisma` | — |
| 2 | S1-2 | Run db:push to apply | — | S1-1 |
| 3 | S1-3 | Update validation constants | `src/lib/validations/common.ts` | S1-1 |
| 4 | S1-4 | Update env.ts with Paystack vars | `src/lib/env.ts` | — |
| 5 | S1-5 | Add Paystack env to .env | `.env` | S1-4 |

**Schema Changes Detail:**

Payment model evolution:
- `method` → rename to `provider` (default `"PAYSTACK"`)
- Add `expiresAt DateTime?`
- Add `processedAt DateTime?`
- Add `completedAt DateTime?`
- Add `failedAt DateTime?`
- Add `cancelledAt DateTime?`
- Add `cancelledReason String?`

TicketType model:
- Add `reservedCount Int @default(0)`

Booking model:
- Add `confirmedAt DateTime?`
- Add `expiresAt DateTime?` (payment timeout)

New model: PaymentAttempt
```
PaymentAttempt:
  id              String   @id @default(cuid())
  paymentId       String
  provider        String   // PAYSTACK, MANUAL
  providerRef     String?  // Reference from provider for this attempt
  status          String   @default("PENDING") // PENDING, SUCCESS, FAILED
  requestPayload  String?  // JSON — what was sent to provider
  responsePayload String?  // JSON — what provider returned
  failureReason   String?
  createdAt       DateTime @default(now())
  
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  
  @@index([paymentId])
  @@index([status])
```

New model: PaymentWebhookEvent
```
PaymentWebhookEvent:
  id              String   @id @default(cuid())
  provider        String   @default("PAYSTACK")
  eventId         String   @unique // Provider's event ID (dedup key)
  eventType       String   // charge.success, charge.failed, etc.
  payload         String   // JSON — raw webhook body
  signature       String?  // HMAC signature for verification
  processed       Boolean  @default(false)
  processedAt     DateTime?
  processingError String?
  createdAt       DateTime @default(now())
  
  @@index([processed])
  @@index([createdAt])
```

New model: Refund
```
Refund:
  id              String   @id @default(cuid())
  paymentId       String
  amount          Int      // Integer minor units
  reason          String?
  status          String   @default("REQUESTED") // REQUESTED, PROCESSING, COMPLETED, FAILED
  providerRef     String?  // Provider's refund reference
  failureReason   String?
  requestedBy     String?  // userId who requested
  processedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  
  @@index([paymentId])
  @@index([status])
```

Payment model: Add relations
```
  attempts     PaymentAttempt[]
  webhookEvents PaymentWebhookEvent[]
  refunds      Refund[]
```

#### STAGE 2: Core Services (State Machines + Business Logic)

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 6 | S2-1 | Payment state machine | `src/lib/services/payment-service.ts` | S1-2 |
| 7 | S2-2 | Payment provider interface | `src/lib/providers/payment-provider.ts` | — |
| 8 | S2-3 | Paystack provider | `src/lib/providers/paystack.ts` | S2-2, S1-4 |
| 9 | S2-4 | Manual provider (admin) | `src/lib/providers/manual.ts` | S2-2 |
| 10 | S2-5 | Booking service | `src/lib/services/booking-service.ts` | S2-1 |
| 11 | S2-6 | Ticket service | `src/lib/services/ticket-service.ts` | S2-5 |
| 12 | S2-7 | Refund service | `src/lib/services/refund-service.ts` | S2-1, S2-2 |
| 13 | S2-8 | Webhook service | `src/lib/services/webhook-service.ts` | S2-1, S2-2 |

**Service Contracts:**

```typescript
// payment-service.ts — Payment State Machine
export class PaymentService {
  static canTransition(from: PaymentStatus, to: PaymentStatus): boolean
  static transition(payment: Payment, to: PaymentStatus, meta?: TransitionMeta): PaymentUpdate
  static markProcessing(paymentId: string, providerRef: string): Promise<Payment>
  static markCompleted(paymentId: string, tx?: PrismaTx): Promise<Payment>
  static markFailed(paymentId: string, reason: string): Promise<Payment>
  static markCancelled(paymentId: string, reason: string): Promise<Payment>
  static markExpired(paymentId: string): Promise<Payment>
  static isExpired(payment: Payment): boolean
  static findExpiredPayments(): Promise<Payment[]>
}

// booking-service.ts — Booking with Payment Boundaries
export class BookingService {
  static createPaidBooking(params): Promise<{ booking, payment, authorizationUrl }>
  static createFreeBooking(params): Promise<{ booking, tickets }>
  static confirmBooking(bookingId: string, tx?: PrismaTx): Promise<Booking>
  static cancelBooking(bookingId: string, cancelledBy: string, reason?: string): Promise<Booking>
  static reserveInventory(ticketTypeId: string, quantity: number, tx: PrismaTx): Promise<boolean>
  static releaseReservation(ticketTypeId: string, quantity: number, tx: PrismaTx): Promise<void>
  static convertReservationToSale(ticketTypeId: string, quantity: number, tx: PrismaTx): Promise<void>
}

// ticket-service.ts — Deferred Ticket Issuance
export class TicketService {
  static issueTickets(bookingId: string, tx?: PrismaTx): Promise<Ticket[]>
  static cancelTickets(bookingId: string, tx: PrismaTx): Promise<void>
  static canCheckIn(ticket: Ticket, booking: Booking): boolean
}

// refund-service.ts — Refund Lifecycle
export class RefundService {
  static requestRefund(paymentId: string, amount: number, requestedBy: string, reason?: string): Promise<Refund>
  static processRefund(refundId: string): Promise<Refund>
  static markRefundCompleted(refundId: string, providerRef: string): Promise<Refund>
  static markRefundFailed(refundId: string, reason: string): Promise<Refund>
}

// webhook-service.ts — Webhook Processing
export class WebhookService {
  static verifySignature(payload: string, signature: string, secret: string): boolean
  static processWebhook(event: WebhookEvent): Promise<WebhookResult>
  static isDuplicate(eventId: string): Promise<boolean>
}
```

#### STAGE 3: API Routes (Endpoints)

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 14 | S3-1 | Payment initialize | `src/app/api/payments/initialize/route.ts` | S2-1, S2-5 |
| 15 | S3-2 | Paystack callback | `src/app/api/payments/callback/route.ts` | S2-1 |
| 16 | S3-3 | Payment verify | `src/app/api/payments/[id]/verify/route.ts` | S2-1, S2-3 |
| 17 | S3-4 | Paystack webhook | `src/app/api/webhooks/paystack/route.ts` | S2-8 |
| 18 | S3-5 | Refund request | `src/app/api/payments/[id]/refund/route.ts` | S2-7 |
| 19 | S3-6 | Payment expiry cleanup | `src/app/api/payments/expire/route.ts` | S2-1 |

#### STAGE 4: Fix Existing Routes

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 20 | S4-1 | Fix booking creation route | `src/app/api/events/[id]/book/route.ts` | S2-5, S2-6 |
| 21 | S4-2 | Fix booking cancellation route | `src/app/api/bookings/[id]/cancel/route.ts` | S2-5, S2-7 |
| 22 | S4-3 | Fix ticket check-in guard | `src/app/api/tickets/[qrCode]/route.ts` | S2-6 |

#### STAGE 5: Seed Data + Environment

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 23 | S5-1 | Update seed with new scenarios | `prisma/seed.ts` | S1-2 |
| 24 | S5-2 | Add Paystack env variables | `.env` | — |

#### STAGE 6: Verification

| Step | ID | Task | Files | Depends |
|------|----|------|-------|---------|
| 25 | S6-1 | Lint check | — | All above |
| 26 | S6-2 | Dev server check | — | S6-1 |
| 27 | S6-3 | Agent browser verification | — | S6-2 |

---

## PART 3: FINANCIAL INVARIANTS (Non-Negotiable)

1. **Paid bookings start PENDING** — never CONFIRMED before payment completion
2. **Never issue VALID tickets for unpaid bookings** — tickets created with PENDING status for paid bookings
3. **Free events remain immediately confirmed** — zero-amount bookings skip payment flow
4. **Inventory reservation is separate from sale** — `reservedCount` for pending, `soldCount` for confirmed
5. **Payment state transitions are validated** — no PENDING→COMPLETED skips (must go through PROCESSING)
6. **Refunded amount never exceeds payment amount** — `refundedAmount <= amount` always
7. **Webhook dedup is mandatory** — same event never processed twice
8. **Idempotency keys prevent duplicate bookings** — same key returns existing booking
9. **Payment expiry releases inventory** — expired payments release `reservedCount`
10. **No subscription billing in this phase** — OrganizerSubscription is separate future domain

---

## PART 4: MIGRATION SAFETY

**Existing data reconciliation for CONFIRMED bookings with PENDING payments:**

The seed data has a paid booking (evt-2) with PENDING payment but CONFIRMED status. This is the exact bug we're fixing. After schema migration:

- **Option A (Grandfather):** Leave existing CONFIRMED+PENDING records as-is. Add a comment noting they're pre-5E data. Risk: inconsistent state.
- **Option B (Backfill):** For any Booking with status=CONFIRMED that has a Payment with status=PENDING and amount>0, set Booking.status=PENDING and add Booking.expiresAt. This is the **correct** option.

**Decision:** Option B — backfill in migration. The seed will be updated to reflect correct states.

---

## PART 5: RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Schema migration breaks existing data | Low | High | Option B backfill + seed update |
| Paystack test mode behaves differently | Medium | Medium | Document test vs live URL config |
| Payment state machine allows invalid transition | Low | Critical | Exhaustive validation in `canTransition()` |
| Webhook signature verification fails | Medium | High | Log raw payload + signature on failure |
| Inventory leak from abandoned payments | Medium | High | Payment expiry cron + cleanup endpoint |
| Race condition on payment completion | Low | Critical | Atomic conditional updates in transaction |

---

**Plan Status:** ✅ READY FOR IMPLEMENTATION
**Next Step:** Begin Stage 1 (Schema + Core Types)
