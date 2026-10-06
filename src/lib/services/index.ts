/**
 * Phase 5E Stage 2: Service Layer Index
 *
 * Re-exports all payment domain services for convenient importing.
 */

// State machine
export {
  validatePaymentTransition,
  isTransitionAllowed,
  getAllowedTransitions,
  isTerminalStatus,
  canBeRefunded,
  canBeExpired,
  type PaymentStatus,
  type PaymentTransitionResult,
} from './payment-state-machine';

// Domain errors
export {
  PaymentDomainError,
  InvalidPaymentTransition,
  ProviderNotSupported,
  ProviderIntegrationPending,
  InsufficientInventory,
  InventoryInvariantViolation,
  BookingNotFound,
  PaymentNotFound,
  PaymentAlreadyConfirmed,
  FreeEventRequiresFreeProvider,
  RefundNotFound,
  RefundNotEligible,
  RefundAmountExceedsPayment,
  DuplicateRefund,
  WebhookAlreadyProcessed,
  WebhookAmountMismatch,
  WebhookCurrencyMismatch,
  PaymentNotExpirable,
} from './payment-domain-errors';

// Provider abstraction
export {
  providerRegistry,
  type IPaymentProvider,
  type PaymentProviderName,
  type PaymentProviderValue,
  type PaymentCustomer,
  type InitializePaymentRequest,
  type InitializePaymentResult,
  type InitializePaymentFailure,
  type InitializePaymentOutcome,
  type VerifyPaymentRequest,
  type VerifyPaymentResult,
  type VerifyPaymentFailure,
  type VerifyPaymentOutcome,
  type ProcessWebhookRequest,
  type NormalizedWebhookEvent,
  type ProcessWebhookResult,
  type ProcessWebhookFailure,
  type ProcessWebhookOutcome,
  type RequestRefundRequest,
  type RequestRefundResult,
  type RequestRefundFailure,
  type RequestRefundOutcome,
} from './payment-provider';

// Booking payment service
export {
  createBookingPayment,
  getPaymentForBooking,
  doesBookingRequirePayment,
  determineProvider,
  generateIdempotencyKey,
  type CreateBookingPaymentParams,
  type CreateBookingPaymentResult,
} from './booking-payment';

// Inventory service
export {
  checkInventory,
  reserveInventory,
  releaseReservation,
  confirmReservation,
  directSoldIncrement,
  restoreSoldCount,
  verifyInventoryInvariant,
  type InventoryCheckResult,
} from './inventory';

// Ticket service
export {
  createPendingTickets,
  activateTickets,
  cancelTickets,
  expireTickets,
  getTicketsForBooking,
  countTicketsByStatus,
} from './ticket-service';

// Booking confirmation service
export {
  confirmBookingOnPaymentSuccess,
  type ConfirmBookingOnPaymentSuccessParams,
  type ConfirmBookingResult,
} from './booking-confirmation';

// Payment attempt service
export {
  createPaymentAttempt,
  getPaymentAttempts,
} from './payment-attempt';

// Webhook service
export {
  processWebhookEvent,
  type ProcessWebhookEventParams,
  type ProcessWebhookEventResult,
} from './payment-webhook';

// Refund service
export {
  requestRefund,
  processRefundCompletion,
  processRefundFailure,
  markRefundProcessing,
  type RequestRefundParams,
  type ProcessRefundCompletionParams,
  type ProcessRefundFailureParams,
  type RefundResult,
} from './refund-service';

// Expiry service
export {
  expireEligiblePayments,
  expireSinglePayment,
  countExpirablePayments,
  type ExpirePaymentsResult,
} from './payment-expiry';

// Webhook reconciliation service
export {
  reconcileUnprocessedEvents,
  type ReconcileOptions,
  type ReconcileResult,
  type ReconcileEventDetail,
} from './webhook-reconciliation';

// Existing services (re-exported for convenience)
export {
  validateTransition as validateOrganizerTransition,
  executeLifecycleTransition,
} from './organizer-lifecycle';
