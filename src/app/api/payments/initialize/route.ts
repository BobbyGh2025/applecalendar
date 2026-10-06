/**
 * POST /api/payments/initialize
 *
 * Initialize a payment for a booking.
 * - Auth required (booking owner or SUPER_ADMIN)
 * - Rate limited: 10 req/min
 * - Creates a Payment record via createBookingPayment()
 * - For PAYSTACK provider, attempts provider initialization (returns 501 if pending)
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { initializePaymentSchema } from '@/lib/validations/payments';
import {
  createBookingPayment,
  ProviderIntegrationPending,
} from '@/lib/services';
import { providerRegistry } from '@/lib/services/payment-provider';
import { db } from '@/lib/db';
import { asMoney } from '@/lib/money';
import { logger } from '@/lib/logger';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });

export async function POST(request: NextRequest) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);

    const body = await request.json();
    const parsed = initializePaymentSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { bookingId, provider, callbackUrl } = parsed.data;

    // Load the booking
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        eventId: true,
        totalAmount: true,
        currency: true,
        status: true,
        event: {
          select: {
            organizerId: true,
          },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may initialize payment
    if (booking.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to initialize payment for this booking');
    }

    // Booking must be in PENDING status (awaiting payment)
    if (booking.status !== 'PENDING') {
      throw new ApiError(400, 'BOOKING_NOT_PENDING', `Booking is in ${booking.status} status, but only PENDING bookings can initialize payment`);
    }

    // Create the payment via domain service
    const result = await createBookingPayment({
      bookingId: booking.id,
      userId: booking.userId,
      amount: booking.totalAmount,
      currency: booking.currency,
      provider,
    });

    // If provider is PAYSTACK, attempt provider-side initialization
    let authorizationUrl: string | null = result.authorizationUrl;

    if (result.provider === 'PAYSTACK' && result.requiresPaymentAction) {
      try {
        const paystackProvider = providerRegistry.require('PAYSTACK');
        const initResult = await paystackProvider.initializePayment({
          paymentId: result.paymentId,
          amount: asMoney(booking.totalAmount),
          currency: booking.currency,
          customer: {
            userId: booking.userId,
            email: user.email,
            name: user.name,
          },
          callbackUrl,
          idempotencyKey: result.idempotencyKey,
        });

        if (initResult.success) {
          authorizationUrl = initResult.authorizationUrl;

          // Update the payment with provider reference
          await db.payment.update({
            where: { id: result.paymentId },
            data: { providerRef: initResult.providerReference },
          });
        }
      } catch (error) {
        if (error instanceof ProviderIntegrationPending) {
          // Provider integration not yet implemented — return 501
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'PROVIDER_INTEGRATION_PENDING',
                message: error.message,
                details: error.details,
              },
              payment: {
                id: result.paymentId,
                status: result.status,
                provider: result.provider,
                requiresPaymentAction: result.requiresPaymentAction,
              },
            },
            { status: 501 }
          );
        }
        throw error;
      }
    }

    // Fetch the full payment record for response
    const payment = await db.payment.findUnique({
      where: { id: result.paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        providerRef: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    logger.info('Payment initialized', {
      paymentId: result.paymentId,
      bookingId,
      provider: result.provider,
      userId: user.id,
    });

    return NextResponse.json({
      payment: {
        ...payment,
        authorizationUrl,
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
