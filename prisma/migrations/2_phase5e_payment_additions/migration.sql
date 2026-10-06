-- Phase 5E: Payment & Booking lifecycle additions
-- These columns and tables were added during Phase 5E development via db:push
-- and need to be present in the PostgreSQL migration chain for production.

-- ═══════════════════════════════════════════════════════════════
-- ALTER TABLE: TicketType — add reservedCount for pending payment reservations
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "TicketType" ADD COLUMN "reservedCount" INTEGER NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- ALTER TABLE: Booking — add lifecycle timestamps
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "Booking" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- ═══════════════════════════════════════════════════════════════
-- ALTER TABLE: Payment — add lifecycle timestamps + cancellation reason
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "Payment" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "failedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "cancelledReason" TEXT;

-- Fix default: Payment.method STRIPE → PAYSTACK (Phase 5E rename)
ALTER TABLE "Payment" ALTER COLUMN "method" SET DEFAULT 'PAYSTACK';

-- ═══════════════════════════════════════════════════════════════
-- CREATE TABLE: PaymentAttempt — tracks each payment processing attempt
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PaymentAttempt_paymentId_index" ON "PaymentAttempt"("paymentId");
CREATE INDEX "PaymentAttempt_status_index" ON "PaymentAttempt"("status");

-- ═══════════════════════════════════════════════════════════════
-- CREATE TABLE: PaymentWebhookEvent — deduplication and audit
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PAYSTACK',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventReference" TEXT,
    "payload" TEXT NOT NULL,
    "signature" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentWebhookEvent_eventId_key" UNIQUE ("eventId")
);

CREATE INDEX "PaymentWebhookEvent_processed_index" ON "PaymentWebhookEvent"("processed");
CREATE INDEX "PaymentWebhookEvent_eventReference_index" ON "PaymentWebhookEvent"("eventReference");
CREATE INDEX "PaymentWebhookEvent_createdAt_index" ON "PaymentWebhookEvent"("createdAt");

-- ═══════════════════════════════════════════════════════════════
-- CREATE TABLE: Refund — full refund lifecycle with status machine
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "providerRef" TEXT,
    "failureReason" TEXT,
    "requestedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Refund_paymentId_index" ON "Refund"("paymentId");
CREATE INDEX "Refund_status_index" ON "Refund"("status");

-- ═══════════════════════════════════════════════════════════════
-- INDEX: Booking.expiresAt for expiry sweep queries
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS "Booking_expiresAt_index" ON "Booking"("expiresAt");
