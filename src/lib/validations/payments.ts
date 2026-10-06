/**
 * Phase 5E Stage 3: Payment Validation Schemas
 *
 * Zod schemas for payment-related API endpoints.
 */

import { z } from 'zod';

// ─── Initialize Payment ───

export const initializePaymentSchema = z.object({
  bookingId: z.string().min(1, 'Booking ID is required'),
  provider: z.enum(['PAYSTACK', 'MANUAL', 'FREE']).optional(),
  callbackUrl: z.string().url('Must be a valid URL').optional(),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;

// ─── Verify Payment ───

export const verifyPaymentSchema = z.object({
  providerReference: z.string().min(1, 'Provider reference is required'),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

// ─── Request Refund ───

export const requestRefundSchema = z.object({
  amount: z.number().int('Amount must be an integer').positive('Amount must be positive'),
  reason: z.string().max(500, 'Reason must be at most 500 characters').optional(),
});

export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

// ─── Manual Payment Confirmation (admin only) ───

export const confirmManualPaymentSchema = z.object({
  providerReference: z.string().min(1, 'Provider reference is required').optional(),
  note: z.string().max(500, 'Note must be at most 500 characters').optional(),
});

export type ConfirmManualPaymentInput = z.infer<typeof confirmManualPaymentSchema>;

// ─── Payment Query Params ───

export const paymentQuerySchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']).optional(),
  provider: z.enum(['PAYSTACK', 'MANUAL', 'FREE', 'STRIPE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaymentQueryInput = z.infer<typeof paymentQuerySchema>;

// ─── Process Refund (admin/internal) ───

export const processRefundSchema = z.object({
  providerRef: z.string().min(1, 'Provider reference is required').optional(),
});

export type ProcessRefundInput = z.infer<typeof processRefundSchema>;

// ─── Webhook Query (for debugging) ───

export const webhookQuerySchema = z.object({
  processed: z.enum(['true', 'false']).optional().transform(v =>
    v === 'true' ? true : v === 'false' ? false : undefined
  ),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type WebhookQueryInput = z.infer<typeof webhookQuerySchema>;
