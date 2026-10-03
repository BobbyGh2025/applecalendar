/**
 * Phase 5E Stage 2: Payment Domain Errors
 *
 * Specialized error types for the payment domain.
 * All payment service methods throw these rather than generic ApiError,
 * allowing routes and callers to distinguish payment-specific failures
 * from general API errors.
 *
 * Each error carries a machine-readable `code` and a human-readable `message`,
 * plus optional `details` for debugging (never secrets).
 */

export class PaymentDomainError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PaymentDomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ─── State Machine Errors ───

export class InvalidPaymentTransition extends PaymentDomainError {
  constructor(from: string, to: string, reason?: string) {
    super(
      'INVALID_PAYMENT_TRANSITION',
      `Cannot transition payment from ${from} to ${to}.${reason ? ` ${reason}` : ''}`,
      409,
      { from, to },
    );
    this.name = 'InvalidPaymentTransition';
  }
}

// ─── Provider Errors ───

export class ProviderNotSupported extends PaymentDomainError {
  constructor(provider: string) {
    super(
      'PROVIDER_NOT_SUPPORTED',
      `Payment provider "${provider}" is not supported for new payments`,
      400,
      { provider },
    );
    this.name = 'ProviderNotSupported';
  }
}

export class ProviderIntegrationPending extends PaymentDomainError {
  constructor(provider: string, operation: string) {
    super(
      'PROVIDER_INTEGRATION_PENDING',
      `${provider} ${operation} integration is not yet implemented. Deferred to Stage 3/5.`,
      501,
      { provider, operation },
    );
    this.name = 'ProviderIntegrationPending';
  }
}

// ─── Inventory Errors ───

export class InsufficientInventory extends PaymentDomainError {
  constructor(ticketTypeId: string, requested: number, available: number) {
    super(
      'INSUFFICIENT_INVENTORY',
      `Not enough tickets available. Requested: ${requested}, Available: ${available}`,
      409,
      { ticketTypeId, requested, available },
    );
    this.name = 'InsufficientInventory';
  }
}

export class InventoryInvariantViolation extends PaymentDomainError {
  constructor(ticketTypeId: string, soldCount: number, reservedCount: number, quantity: number) {
    super(
      'INVENTORY_INVARIANT_VIOLATION',
      `Inventory invariant violated: soldCount(${soldCount}) + reservedCount(${reservedCount}) > quantity(${quantity})`,
      500,
      { ticketTypeId, soldCount, reservedCount, quantity },
    );
    this.name = 'InventoryInvariantViolation';
  }
}

// ─── Booking/Payment Errors ───

export class BookingNotFound extends PaymentDomainError {
  constructor(bookingId: string) {
    super('BOOKING_NOT_FOUND', `Booking not found: ${bookingId}`, 404, { bookingId });
    this.name = 'BookingNotFound';
  }
}

export class PaymentNotFound extends PaymentDomainError {
  constructor(paymentId: string) {
    super('PAYMENT_NOT_FOUND', `Payment not found: ${paymentId}`, 404, { paymentId });
    this.name = 'PaymentNotFound';
  }
}

export class PaymentAlreadyConfirmed extends PaymentDomainError {
  constructor(paymentId: string) {
    super(
      'PAYMENT_ALREADY_CONFIRMED',
      `Payment ${paymentId} is already confirmed. Duplicate confirmation ignored.`,
      200,
      { paymentId },
    );
    this.name = 'PaymentAlreadyConfirmed';
  }
}

export class FreeEventRequiresFreeProvider extends PaymentDomainError {
  constructor() {
    super(
      'FREE_EVENT_REQUIRES_FREE_PROVIDER',
      'Free events must use the FREE payment provider',
      400,
    );
    this.name = 'FreeEventRequiresFreeProvider';
  }
}

// ─── Refund Errors ───

export class RefundNotEligible extends PaymentDomainError {
  constructor(paymentId: string, reason: string) {
    super(
      'REFUND_NOT_ELIGIBLE',
      `Payment ${paymentId} is not eligible for refund: ${reason}`,
      400,
      { paymentId, reason },
    );
    this.name = 'RefundNotEligible';
  }
}

export class RefundAmountExceedsPayment extends PaymentDomainError {
  constructor(requested: number, paymentAmount: number) {
    super(
      'REFUND_AMOUNT_EXCEEDS_PAYMENT',
      `Refund amount (${requested}) exceeds payment amount (${paymentAmount})`,
      400,
      { requested, paymentAmount },
    );
    this.name = 'RefundAmountExceedsPayment';
  }
}

export class DuplicateRefund extends PaymentDomainError {
  constructor(paymentId: string) {
    super(
      'DUPLICATE_REFUND',
      `A refund is already in progress or completed for payment ${paymentId}`,
      409,
      { paymentId },
    );
    this.name = 'DuplicateRefund';
  }
}

// ─── Webhook Errors ───

export class WebhookAlreadyProcessed extends PaymentDomainError {
  constructor(eventId: string) {
    super(
      'WEBHOOK_ALREADY_PROCESSED',
      `Webhook event ${eventId} has already been processed`,
      200,
      { eventId },
    );
    this.name = 'WebhookAlreadyProcessed';
  }
}

export class WebhookAmountMismatch extends PaymentDomainError {
  constructor(expected: number, actual: number) {
    super(
      'WEBHOOK_AMOUNT_MISMATCH',
      `Webhook amount mismatch. Expected: ${expected}, Actual: ${actual}`,
      400,
      { expected, actual },
    );
    this.name = 'WebhookAmountMismatch';
  }
}

export class WebhookCurrencyMismatch extends PaymentDomainError {
  constructor(expected: string, actual: string) {
    super(
      'WEBHOOK_CURRENCY_MISMATCH',
      `Webhook currency mismatch. Expected: ${expected}, Actual: ${actual}`,
      400,
      { expected, actual },
    );
    this.name = 'WebhookCurrencyMismatch';
  }
}

// ─── Expiry Errors ───

export class PaymentNotExpirable extends PaymentDomainError {
  constructor(paymentId: string, status: string) {
    super(
      'PAYMENT_NOT_EXPIRABLE',
      `Payment ${paymentId} with status ${status} cannot be expired`,
      400,
      { paymentId, status },
    );
    this.name = 'PaymentNotExpirable';
  }
}
