/**
 * POST /api/payments/:id/confirm-manual
 *
 * Manual payment confirmation (admin/organizer).
 * - Auth required + ORGANIZER or SUPER_ADMIN
 * - Rate limited: 5 req/min
 * - Only for MANUAL provider payments in PENDING/PROCESSING status
 * - The authenticated user must be the event organizer or SUPER_ADMIN
 * - Calls confirmBookingOnPaymentSuccess()
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { confirmManualPaymentSchema } from '@/lib/validations/payments';
import { confirmBookingOnPaymentSuccess } from '@/lib/services';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const { id: paymentId } = await params;

    const body = await request.json();
    const parsed = confirmManualPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { providerReference, note } = parsed.data;

    // Load payment with booking and event
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        provider: true,
        status: true,
        amount: true,
        currency: true,
        booking: {
          select: {
            id: true,
            userId: true,
            bookingRef: true,
            event: {
              select: {
                id: true,
                organizerId: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    // Must be MANUAL provider
    if (payment.provider !== 'MANUAL') {
      throw new ApiError(400, 'INVALID_PROVIDER', 'Manual confirmation is only available for MANUAL provider payments');
    }

    // Must be in PENDING or PROCESSING status
    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
      throw new ApiError(400, 'PAYMENT_NOT_CONFIRMABLE', `Payment is in ${payment.status} status and cannot be manually confirmed`);
    }

    // Authorization: SUPER_ADMIN or the event organizer
    if (user.role !== 'SUPER_ADMIN' && payment.booking?.event.organizerId !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the event organizer or SUPER_ADMIN can manually confirm payments');
    }

    // Update provider reference if provided
    if (providerReference) {
      await db.payment.update({
        where: { id: paymentId },
        data: {
          providerRef: providerReference,
          ...(note && { metadata: JSON.stringify({ manualConfirmationNote: note, confirmedBy: user.id }) }),
        },
      });
    } else if (note) {
      await db.payment.update({
        where: { id: paymentId },
        data: { metadata: JSON.stringify({ manualConfirmationNote: note, confirmedBy: user.id }) },
      });
    }

    // Confirm the booking
    const confirmResult = await confirmBookingOnPaymentSuccess({
      paymentId,
      providerReference: providerReference ?? undefined,
    });

    // Reload payment and booking for response
    const [updatedPayment, updatedBooking] = await Promise.all([
      db.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          amount: true,
          currency: true,
          provider: true,
          status: true,
          providerRef: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      db.booking.findUnique({
        where: { id: payment.booking?.id ?? '' },
        select: {
          id: true,
          bookingRef: true,
          status: true,
          confirmedAt: true,
        },
      }),
    ]);

    logger.info('Manual payment confirmed', {
      paymentId,
      confirmedBy: user.id,
      bookingId: payment.booking?.id,
      confirmed: confirmResult.confirmed,
    });

    return NextResponse.json({
      payment: updatedPayment,
      booking: updatedBooking,
      confirmed: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
