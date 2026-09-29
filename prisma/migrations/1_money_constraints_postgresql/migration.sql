-- Phase 5C: Money Field CHECK Constraints & Financial Query Indexes
-- This migration is PostgreSQL-specific. It adds:
--   1. CHECK constraints ensuring all monetary fields are non-negative integers
--   2. CHECK constraint ensuring refundedAmount <= amount on Payment
--   3. Performance indexes for financial queries
--
-- IMPORTANT: This migration should ONLY be applied when using provider = "postgresql".
-- SQLite does not support ALTER TABLE ADD CONSTRAINT. For SQLite development,
-- these constraints are enforced at the application layer (src/lib/money-constraints.ts).
--
-- To apply: prisma migrate deploy (after switching to PostgreSQL provider)

-- ═══════════════════════════════════════════════════════════════
-- CHECK CONSTRAINTS: Non-negative monetary values
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "chk_subscription_plan_price_nonneg"
  CHECK ("price" >= 0);

ALTER TABLE "TicketType"
  ADD CONSTRAINT "chk_ticket_type_price_nonneg"
  CHECK ("price" >= 0);

ALTER TABLE "Booking"
  ADD CONSTRAINT "chk_booking_total_amount_nonneg"
  CHECK ("totalAmount" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "chk_payment_amount_nonneg"
  CHECK ("amount" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "chk_payment_refunded_nonneg"
  CHECK ("refundedAmount" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "chk_payment_refunded_lte_amount"
  CHECK ("refundedAmount" <= "amount");

ALTER TABLE "EventAnalytics"
  ADD CONSTRAINT "chk_analytics_revenue_nonneg"
  CHECK ("revenue" >= 0);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES: Performance for financial queries
-- ═══════════════════════════════════════════════════════════════

-- Payment lookups by booking + status (common in booking cancellation flow)
CREATE INDEX IF NOT EXISTS "idx_payment_booking_status"
  ON "Payment" ("bookingId", "status");

-- Booking revenue aggregation by event + status
CREATE INDEX IF NOT EXISTS "idx_booking_event_status_amount"
  ON "Booking" ("eventId", "status", "totalAmount");

-- Ticket type pricing queries (price sorting/filtering)
CREATE INDEX IF NOT EXISTS "idx_ticket_type_event_price"
  ON "TicketType" ("eventId", "price");

-- Analytics revenue queries
CREATE INDEX IF NOT EXISTS "idx_analytics_event_revenue"
  ON "EventAnalytics" ("eventId", "revenue");

-- Subscription plan pricing lookups
CREATE INDEX IF NOT EXISTS "idx_subscription_plan_price"
  ON "SubscriptionPlan" ("price", "isActive");
