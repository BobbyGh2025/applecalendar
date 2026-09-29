/**
 * Phase 5C: Money Field Constraints
 *
 * Application-level enforcement of database constraints for monetary fields.
 * Since Prisma doesn't natively support CHECK constraints in the schema DSL,
 * we enforce these at the application layer AND document the PostgreSQL
 * CHECK constraints that should be added in a production migration.
 *
 * PostgreSQL CHECK constraints (to be added in migration):
 *
 *   ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "chk_subscription_plan_price_nonneg" CHECK ("price" >= 0);
 *   ALTER TABLE "TicketType"        ADD CONSTRAINT "chk_ticket_type_price_nonneg"       CHECK ("price" >= 0);
 *   ALTER TABLE "Booking"           ADD CONSTRAINT "chk_booking_total_amount_nonneg"    CHECK ("totalAmount" >= 0);
 *   ALTER TABLE "Payment"           ADD CONSTRAINT "chk_payment_amount_nonneg"          CHECK ("amount" >= 0);
 *   ALTER TABLE "Payment"           ADD CONSTRAINT "chk_payment_refunded_nonneg"        CHECK ("refundedAmount" >= 0);
 *   ALTER TABLE "Payment"           ADD CONSTRAINT "chk_payment_refunded_lte_amount"    CHECK ("refundedAmount" <= "amount");
 *   ALTER TABLE "EventAnalytics"    ADD CONSTRAINT "chk_analytics_revenue_nonneg"       CHECK ("revenue" >= 0);
 *
 * Additional recommended indexes for financial queries:
 *
 *   CREATE INDEX idx_payment_booking_status  ON "Payment" ("bookingId", "status");
 *   CREATE INDEX idx_booking_event_status    ON "Booking"  ("eventId", "status", "totalAmount");
 *   CREATE INDEX idx_ticket_type_event_price ON "TicketType" ("eventId", "price");
 *   CREATE INDEX idx_analytics_event_revenue ON "EventAnalytics" ("eventId", "revenue");
 */

import { isValidMoney, type Money } from './money';

/**
 * Validate that a monetary value meets the non-negative integer constraint.
 * Throws if the value is negative or not a safe integer.
 */
export function assertNonNegativeMoney(value: number, fieldName: string): asserts value is Money {
  if (!isValidMoney(value)) {
    throw new Error(
      `Constraint violation: ${fieldName} must be a non-negative safe integer, got ${value}`
    );
  }
}

/**
 * Validate that refundedAmount <= amount (payment integrity constraint).
 */
export function assertRefundedNotExceedAmount(refundedAmount: number, amount: number): void {
  if (refundedAmount > amount) {
    throw new Error(
      `Constraint violation: refundedAmount (${refundedAmount}) cannot exceed amount (${amount})`
    );
  }
}

/**
 * Validate all monetary fields on a Payment record before write.
 */
export function validatePaymentMoneyConstraints(data: {
  amount: number;
  refundedAmount?: number;
}): void {
  assertNonNegativeMoney(data.amount, 'Payment.amount');
  if (data.refundedAmount !== undefined) {
    assertNonNegativeMoney(data.refundedAmount, 'Payment.refundedAmount');
    assertRefundedNotExceedAmount(data.refundedAmount, data.amount);
  }
}

/**
 * Validate monetary fields on a Booking record before write.
 */
export function validateBookingMoneyConstraints(data: {
  totalAmount: number;
}): void {
  assertNonNegativeMoney(data.totalAmount, 'Booking.totalAmount');
}

/**
 * Validate monetary fields on a TicketType record before write.
 */
export function validateTicketTypeMoneyConstraints(data: {
  price: number;
}): void {
  assertNonNegativeMoney(data.price, 'TicketType.price');
}

/**
 * Validate monetary fields on a SubscriptionPlan record before write.
 */
export function validateSubscriptionPlanMoneyConstraints(data: {
  price: number;
}): void {
  assertNonNegativeMoney(data.price, 'SubscriptionPlan.price');
}

/**
 * Validate monetary fields on an EventAnalytics record before write.
 */
export function validateEventAnalyticsMoneyConstraints(data: {
  revenue: number;
}): void {
  assertNonNegativeMoney(data.revenue, 'EventAnalytics.revenue');
}
