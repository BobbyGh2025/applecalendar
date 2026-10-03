/**
 * Phase 5E Stage 2: Paystack Provider Adapter — Interface Only
 *
 * Implements the IPaymentProvider interface for Paystack.
 *
 * *** NO NETWORK CALLS ARE MADE IN STAGE 2 ***
 *
 * All methods throw ProviderIntegrationPending, clearly indicating
 * that actual Paystack HTTP integration is deferred to Stage 3/5.
 * This ensures:
 * - No silent success (placeholder responses would be dangerous)
 * - No accidental Paystack API calls
 * - The adapter structure is established for future implementation
 * - Type safety is maintained throughout
 */

import type {
  IPaymentProvider,
  InitializePaymentRequest,
  InitializePaymentOutcome,
  VerifyPaymentRequest,
  VerifyPaymentOutcome,
  ProcessWebhookRequest,
  ProcessWebhookOutcome,
  RequestRefundRequest,
  RequestRefundOutcome,
} from '../payment-provider';
import { ProviderIntegrationPending } from '../payment-domain-errors';

class PaystackProvider implements IPaymentProvider {
  readonly name = 'PAYSTACK' as const;

  async initializePayment(_request: InitializePaymentRequest): Promise<InitializePaymentOutcome> {
    throw new ProviderIntegrationPending('PAYSTACK', 'initializePayment');
  }

  async verifyPayment(_request: VerifyPaymentRequest): Promise<VerifyPaymentOutcome> {
    throw new ProviderIntegrationPending('PAYSTACK', 'verifyPayment');
  }

  async processWebhook(_request: ProcessWebhookRequest): Promise<ProcessWebhookOutcome> {
    throw new ProviderIntegrationPending('PAYSTACK', 'processWebhook');
  }

  async requestRefund(_request: RequestRefundRequest): Promise<RequestRefundOutcome> {
    throw new ProviderIntegrationPending('PAYSTACK', 'requestRefund');
  }
}

/** Singleton Paystack adapter (interface only — no network calls) */
export const paystackProvider = new PaystackProvider();
