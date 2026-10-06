/**
 * POST /api/events/[id]/book
 *
 * Authoritative paid-booking lifecycle (Phase 5E Stage 3 Closure):
 *
 * For PAID events (price > 0):
 *   Booking PENDING
 *   → inventory RESERVED (reservedCount++)
 *   → Payment PENDING (via createBookingPayment)
 *   → Tickets PENDING (via createPendingTickets)
 *   → Booking expiresAt set
 *   → Return booking with payment instructions
 *
 *   Later, on payment success (webhook/verify/manual):
 *   → Payment COMPLETED → Booking CONFIRMED → soldCount++ → Tickets VALID
 *   (handled by confirmBookingOnPaymentSuccess)
 *
 * For FREE events (price = 0):
 *   Booking CONFIRMED (immediately)
 *   → Payment COMPLETED/FREE (via createBookingPayment)
 *   → inventory SOLD (soldCount++ via directSoldIncrement)
 *   → Tickets VALID (via createPendingTickets + activateTickets)
 *   → No expiry
 *
 * CRITICAL INVARIANTS:
 *   - Paid booking is NEVER CONFIRMED before successful payment
 *   - Paid booking NEVER receives VALID tickets before successful payment
 *   - soldCount is NEVER incremented for an unpaid reservation
 *   - reservedCount tracks pending-payment inventory
 *   - Notification failure does NOT roll back financial state
 *
 * Idempotency:
 *   - Idempotency key on Payment prevents duplicate payment creation
 *   - createPendingTickets is idempotent (checks existing ticket count)
 *   - Concurrent requests cannot oversell (raw SQL conditional updates)
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { ApiError, handleApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { createBookingSchema } from '@/lib/validations';
import { multiplyMoney, asMoney } from '@/lib/money';
import {
  createBookingPayment,
  reserveInventory,
  directSoldIncrement,
  createPendingTickets,
  activateTickets,
  confirmBookingOnPaymentSuccess,
} from '@/lib/services';
import { logger } from '@/lib/logger';

const bookingLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = bookingLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

    const user = await authenticate(request);
    const { id } = await params;

    const body = await request.json();

    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { ticketTypeId, quantity } = parsed.data;

    // Find the event
    const event = await db.event.findUnique({
      where: { id },
      include: {
        ticketTypes: { where: { id: ticketTypeId } },
        organizer: { select: { id: true, name: true } },
      },
    });

    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Phase 4G: Comprehensive event bookability checks
    if (event.status === 'CANCELLED') {
      throw new ApiError(400, 'EVENT_NOT_BOOKABLE', 'This event has been cancelled');
    }
    if (event.status === 'COMPLETED') {
      throw new ApiError(400, 'EVENT_NOT_BOOKABLE', 'This event has already taken place');
    }
    if (event.status !== 'PUBLISHED') {
      throw new ApiError(400, 'EVENT_NOT_BOOKABLE', 'Event is not available for booking');
    }
    if (!event.isBookable) {
      throw new ApiError(400, 'EVENT_NOT_BOOKABLE', 'Booking is currently unavailable for this event');
    }

    // Phase 4G: Cross-event ticket type validation
    const ticketType = event.ticketTypes[0];
    if (!ticketType) {
      const ttExists = await db.ticketType.findUnique({ where: { id: ticketTypeId } });
      if (ttExists) {
        throw new ApiError(403, 'CROSS_EVENT_REFERENCE', 'Ticket type does not belong to this event');
      }
      throw new ApiError(404, 'NOT_FOUND', 'Ticket type not found');
    }

    if (!ticketType.isActive) {
      throw new ApiError(400, 'TICKET_TYPE_INACTIVE', 'This ticket type is no longer available');
    }

    // Phase 4G: Sale window enforcement
    const now = new Date();
    if (ticketType.saleStart && now < ticketType.saleStart) {
      throw new ApiError(400, 'SALE_NOT_STARTED', 'Ticket sales have not started yet');
    }
    if (ticketType.saleEnd && now > ticketType.saleEnd) {
      throw new ApiError(400, 'SALE_ENDED', 'Ticket sales have ended');
    }

    // Check min/max per order
    if (quantity < ticketType.minPerOrder) {
      throw new ApiError(400, 'INVALID_QUANTITY', `Minimum ${ticketType.minPerOrder} tickets per order`);
    }
    if (quantity > ticketType.maxPerOrder) {
      throw new ApiError(400, 'INVALID_QUANTITY', `Maximum ${ticketType.maxPerOrder} tickets per order`);
    }

    // Generate booking reference
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    const bookingRef = `APC-${timestamp}-${random}`;

    // Calculate total (integer minor units — Phase 5C)
    const totalAmount = multiplyMoney(asMoney(ticketType.price), quantity);
    const isFree = totalAmount === 0;

    // ─── PAID BOOKING LIFECYCLE ───
    // Booking PENDING → inventory RESERVED → Payment PENDING → Tickets PENDING
    if (!isFree) {
      // 1. Reserve inventory atomically (reservedCount++)
      // Uses raw SQL conditional update — two concurrent requests for the last ticket cannot both succeed
      await reserveInventory({ ticketTypeId, quantity });

      // 2. Create booking as PENDING, payment, and tickets in a transaction
      const result = await db.$transaction(async (tx) => {
        // Create booking in PENDING status (NOT CONFIRMED — payment pending)
        const booking = await tx.booking.create({
          data: {
            userId: user.id,
            eventId: id,
            totalAmount,
            currency: ticketType.currency,
            status: 'PENDING',
            bookingRef,
            // Booking expiry will be set after payment is created (same time as payment expiry)
          },
        });

        // Create payment record via domain service
        const paymentResult = await createBookingPayment({
          bookingId: booking.id,
          userId: user.id,
          amount: totalAmount,
          currency: ticketType.currency,
        });

        // Set booking expiry to match payment expiry
        if (paymentResult.expiresAt) {
          await tx.booking.update({
            where: { id: booking.id },
            data: { expiresAt: paymentResult.expiresAt },
          });
        }

        // Create tickets in PENDING state (NOT VALID — payment not yet confirmed)
        const ticketResult = await createPendingTickets({
          bookingId: booking.id,
          ticketTypeId,
          quantity,
          bookingRef,
          tx,
        });

        // Load the payment record for response
        const payment = await tx.payment.findUnique({
          where: { id: paymentResult.paymentId },
          select: {
            id: true,
            amount: true,
            currency: true,
            provider: true,
            status: true,
            providerRef: true,
            expiresAt: true,
            idempotencyKey: true,
            createdAt: true,
          },
        });

        return {
          booking,
          ticketIds: ticketResult.ticketIds,
          payment,
          requiresPaymentAction: paymentResult.requiresPaymentAction,
        };
      });

      // Notification AFTER transaction commits (failure does NOT roll back financial state)
      try {
        await db.notification.create({
          data: {
            userId: user.id,
            title: 'Booking Created — Payment Required',
            message: `Your booking ${bookingRef} for "${event.title}" has been created. Please complete payment to confirm your ${quantity} ticket(s).`,
            type: 'BOOKING',
            link: `/events/${id}`,
          },
        });
      } catch (notificationError) {
        logger.error('Failed to create booking notification', {
          bookingRef,
          error: notificationError instanceof Error ? notificationError.message : 'unknown',
        });
      }

      logger.info('Paid booking created (awaiting payment)', {
        bookingId: result.booking.id,
        bookingRef,
        paymentId: result.payment?.id,
        amount: totalAmount,
        currency: ticketType.currency,
        userId: user.id,
      });

      return NextResponse.json({
        booking: result.booking,
        payment: result.payment,
        requiresPaymentAction: result.requiresPaymentAction,
        message: 'Booking created. Payment is required to confirm your tickets.',
      }, { status: 201 });
    }

    // ─── FREE BOOKING LIFECYCLE ───
    // Booking CONFIRMED → Payment COMPLETED/FREE → inventory SOLD → Tickets VALID
    //
    // Free bookings are immediately confirmable — no payment action needed.
    // We use the domain services to ensure consistency with the paid flow.

    // 1. Directly increment soldCount (no reservation needed for free bookings)
    await directSoldIncrement(ticketTypeId, quantity);

    // 2. Create booking, payment, and tickets in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create booking as CONFIRMED (free event — no payment needed)
      const booking = await tx.booking.create({
        data: {
          userId: user.id,
          eventId: id,
          totalAmount: 0,
          currency: ticketType.currency,
          status: 'CONFIRMED',
          bookingRef,
          confirmedAt: new Date(),
        },
      });

      // Create COMPLETED FREE payment via domain service
      const paymentResult = await createBookingPayment({
        bookingId: booking.id,
        userId: user.id,
        amount: 0,
        currency: ticketType.currency,
      });

      // Create tickets as PENDING then immediately activate them
      const ticketResult = await createPendingTickets({
        bookingId: booking.id,
        ticketTypeId,
        quantity,
        bookingRef,
        tx,
      });

      // Activate tickets: PENDING → VALID
      const activationResult = await activateTickets({
        bookingId: booking.id,
        tx,
      });

      // Load the payment for response
      const payment = await tx.payment.findUnique({
        where: { id: paymentResult.paymentId },
        select: {
          id: true,
          amount: true,
          currency: true,
          provider: true,
          status: true,
          completedAt: true,
          createdAt: true,
        },
      });

      return {
        booking,
        ticketIds: ticketResult.ticketIds,
        ticketsActivated: activationResult.activated,
        payment,
      };
    });

    // Notification AFTER transaction commits
    try {
      await db.notification.create({
        data: {
          userId: user.id,
          title: 'Booking Confirmed',
          message: `Your booking ${bookingRef} for "${event.title}" has been confirmed. ${quantity} ticket(s) reserved.`,
          type: 'BOOKING',
          link: `/events/${id}`,
        },
      });
    } catch (notificationError) {
      logger.error('Failed to create booking confirmation notification', {
        bookingRef,
        error: notificationError instanceof Error ? notificationError.message : 'unknown',
      });
    }

    logger.info('Free booking created and confirmed', {
      bookingId: result.booking.id,
      bookingRef,
      userId: user.id,
    });

    return NextResponse.json({
      booking: result.booking,
      payment: result.payment,
      requiresPaymentAction: false,
      message: 'Booking confirmed. Your tickets are ready.',
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
