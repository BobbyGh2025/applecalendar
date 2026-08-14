import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { ApiError, handleApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { createBookingSchema } from '@/lib/validations';

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
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Event is not available for booking' }, { status: 400 });
    }

    const ticketType = event.ticketTypes[0];
    if (!ticketType) {
      return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 });
    }

    if (!ticketType.isActive) {
      return NextResponse.json({ error: 'This ticket type is no longer available' }, { status: 400 });
    }

    // Check min/max per order (outside transaction, just validation)
    if (quantity < ticketType.minPerOrder) {
      return NextResponse.json(
        { error: `Minimum ${ticketType.minPerOrder} tickets per order` },
        { status: 400 }
      );
    }
    if (quantity > ticketType.maxPerOrder) {
      return NextResponse.json(
        { error: `Maximum ${ticketType.maxPerOrder} tickets per order` },
        { status: 400 }
      );
    }

    // Generate booking reference
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    const bookingRef = `APC-${timestamp}-${random}`;

    // Calculate total
    const totalAmount = ticketType.price * quantity;

    // Create booking, tickets, and payment in a transaction with atomic availability check
    const result = await db.$transaction(async (tx) => {
      // Atomic availability check: increment soldCount only if enough remain
      const updateResult = await tx.ticketType.updateMany({
        where: {
          id: ticketTypeId,
          soldCount: { lte: ticketType.quantity - quantity },
        },
        data: {
          soldCount: { increment: quantity },
        },
      });

      if (updateResult.count === 0) {
        throw new ApiError(409, 'TICKETS_SOLD_OUT', 'Not enough tickets available. They may have been claimed by another user.');
      }

      // Create booking
      const booking = await tx.booking.create({
        data: {
          userId: user.id,
          eventId: id,
          totalAmount,
          currency: ticketType.currency,
          status: 'CONFIRMED',
          bookingRef,
        },
      });

      // Create payment record
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          userId: user.id,
          amount: totalAmount,
          currency: ticketType.currency,
          method: totalAmount > 0 ? 'STRIPE' : 'FREE',
          status: totalAmount > 0 ? 'PENDING' : 'COMPLETED',
        },
      });

      // Create tickets with crypto-strong QR codes
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticketRandom = crypto.randomBytes(16).toString('hex').toUpperCase();
        const qrCode = `QR-${bookingRef}-${ticketRandom}`;
        const ticket = await tx.ticket.create({
          data: {
            ticketTypeId,
            bookingId: booking.id,
            qrCode,
            status: 'VALID',
          },
        });
        tickets.push(ticket);
      }

      // Create notification
      await tx.notification.create({
        data: {
          userId: user.id,
          title: 'Booking Confirmed',
          message: `Your booking ${bookingRef} for "${event.title}" has been confirmed. ${quantity} ticket(s) reserved.`,
          type: 'BOOKING',
          link: `/events/${id}`,
        },
      });

      return { booking, tickets };
    });

    return NextResponse.json({
      booking: result.booking,
      tickets: result.tickets,
      message: 'Booking created successfully',
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
