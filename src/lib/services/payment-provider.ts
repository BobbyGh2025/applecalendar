/**
 * Phase 5E Stage 2: Payment Provider Abstraction
 *
 * Provider-neutral interface for payment operations.
 * Domain services depend on this interface, never on a specific provider.
 * Paystack-specific details are confined to the adapter implementation.
 *
 * All monetary values are integer minor units throughout.
 * Provider results are normalized into internal structures —
 * no external response shapes leak into domain services.
 */

import type { Money } from '@/lib/money';

// ─── Provider Types ───

/** Supported payment providers for new payments */
export type PaymentProviderName = 'PAYSTACK' | 'MANUAL' | 'FREE';

/** All valid provider values in the database (includes legacy STRIPE) */
export type PaymentProviderValue = PaymentProviderName | 'STRIPE';

// ─── Customer Information ───

export interface PaymentCustomer {
  /** Internal user ID */
  userId: string;
  /** Customer email (required by most providers for receipt) */
  email: string;
  /** Customer name (optional, for provider reference) */
  name?: string;
  /** Customer phone (optional) */
  phone?: string;
}

// ─── Initialize Payment ───

export interface InitializePaymentRequest {
  /** Internal payment ID */
  paymentId: string;
  /** Amount in integer minor units */
  amount: Money;
  /** ISO 4217 currency code */
  currency: string;
  /** Customer information */
  customer: PaymentCustomer;
  /** Callback/redirect URL after payment completion */
  callbackUrl?: string;
  /** Idempotency key for deduplication */
  idempotencyKey: string;
  /** Additional metadata to pass to provider */
  metadata?: Record<string, string>;
}

export interface InitializePaymentResult {
  /** Whether initialization succeeded */
  success: true;
  /** Provider-specific reference for this payment */
  providerReference: string;
  /** URL to redirect the customer to for payment (null for MANUAL/FREE) */
  authorizationUrl: string | null;
  /** Provider-specific access code (if applicable) */
  accessCode?: string;
}

export interface InitializePaymentFailure {
  success: false;
  /** Machine-readable error code */
  errorCode: string;
  /** Human-readable error message */
  errorMessage: string;
  /** Whether retrying might succeed */
  retryable: boolean;
}

export type InitializePaymentOutcome = InitializePaymentResult | InitializePaymentFailure;

// ─── Verify Payment ───

export interface VerifyPaymentRequest {
  /** Internal payment ID */
  paymentId: string;
  /** Provider reference to verify */
  providerReference: string;
  /** Expected amount in minor units (for verification) */
  expectedAmount: Money;
  /** Expected currency (for verification) */
  expectedCurrency: string;
}

export interface VerifyPaymentResult {
  success: true;
  /** Verified amount in minor units */
  verifiedAmount: Money;
  /** Verified currency */
  verifiedCurrency: string;
  /** Provider reference (confirmed) */
  providerReference: string;
  /** When the payment was completed at the provider */
  paidAt: Date;
}

export interface VerifyPaymentFailure {
  success: false;
  errorCode: string;
  errorMessage: string;
  /** If verification shows payment is still pending at provider */
  isPending?: boolean;
}

export type VerifyPaymentOutcome = VerifyPaymentResult | VerifyPaymentFailure;

// ─── Process Webhook ───

export interface ProcessWebhookRequest {
  /** Raw webhook payload */
  rawPayload: string;
  /** Webhook signature/header for verification */
  signature: string;
  /** Provider name (to select the correct adapter) */
  provider: PaymentProviderName;
}

export interface NormalizedWebhookEvent {
  /** Provider that sent this event */
  provider: PaymentProviderName;
  /** Unique event ID from the provider (for deduplication) */
  eventId: string;
  /** Event type (e.g., "charge.success", "charge.failed") */
  eventType: string;
  /** Provider reference for the payment this event relates to */
  eventReference: string;
  /** Amount in minor units from the webhook */
  amount: Money;
  /** Currency from the webhook */
  currency: string;
  /** When the event occurred at the provider */
  eventAt: Date;
  /** Whether this event indicates successful payment */
  isPaymentSuccess: boolean;
  /** Whether this event indicates failed payment */
  isPaymentFailure: boolean;
}

export interface ProcessWebhookResult {
  success: true;
  /** Normalized event data */
  event: NormalizedWebhookEvent;
}

export interface ProcessWebhookFailure {
  success: false;
  errorCode: string;
  errorMessage: string;
}

export type ProcessWebhookOutcome = ProcessWebhookResult | ProcessWebhookFailure;

// ─── Request Refund ───

export interface RequestRefundRequest {
  /** Internal payment ID */
  paymentId: string;
  /** Provider reference of the original payment */
  providerReference: string;
  /** Refund amount in minor units */
  amount: Money;
  /** Currency */
  currency: string;
  /** Reason for refund */
  reason?: string;
}

export interface RequestRefundResult {
  success: true;
  /** Provider reference for this refund */
  refundReference: string;
}

export interface RequestRefundFailure {
  success: false;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export type RequestRefundOutcome = RequestRefundResult | RequestRefundFailure;

// ─── Provider Interface ───

/**
 * The payment provider interface.
 * All providers must implement these operations.
 */
export interface IPaymentProvider {
  /** Provider name */
  readonly name: PaymentProviderName;

  /** Initialize a payment with the provider */
  initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentOutcome>;

  /** Verify a payment's status with the provider */
  verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentOutcome>;

  /** Process and normalize a webhook from the provider */
  processWebhook(request: ProcessWebhookRequest): Promise<ProcessWebhookOutcome>;

  /** Request a refund from the provider */
  requestRefund(request: RequestRefundRequest): Promise<RequestRefundOutcome>;
}

// ─── Provider Registry ───

/**
 * Registry for payment provider adapters.
 * Routes provider-specific operations to the correct adapter.
 */
class PaymentProviderRegistry {
  private providers: Map<PaymentProviderName, IPaymentProvider> = new Map();

  register(provider: IPaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: PaymentProviderName): IPaymentProvider | undefined {
    return this.providers.get(name);
  }

  /** Get a provider or throw if not registered */
  require(name: PaymentProviderName): IPaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Payment provider "${name}" is not registered`);
    }
    return provider;
  }

  /** List all registered provider names */
  listRegistered(): PaymentProviderName[] {
    return Array.from(this.providers.keys());
  }
}

/** Singleton provider registry */
export const providerRegistry = new PaymentProviderRegistry();
