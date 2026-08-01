import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, AuthError } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;

    const body = await request.json();
    const { ticketTypeId, quantity } = body;

    if (!ticketTypeId || !quantity || quantity < 1) {
      return NextResponse.json({ error: 'ticketTypeId and quantity (>= 1) are required' }, { status: 400 });
    }

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

    // Check availability
    const available = ticketType.quantity - ticketType.soldCount;
    if (available < quantity) {
      return NextResponse.json(
        { error: `Not enough tickets available. Only ${available} tickets remaining.` },
        { status: 400 }
      );
    }

    // Check min/max per order
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
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const bookingRef = `APC-${timestamp}-${random}`;

    // Calculate total
    const totalAmount = ticketType.price * quantity;

    // Create booking, tickets, and payment in a transaction
    const result = await db.$transaction(async (tx) => {
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

      // Create tickets
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticketRandom = Math.random().toString(36).substring(2, 10).toUpperCase();
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

      // Update sold count
      await tx.ticketType.update({
        where: { id: ticketTypeId },
        data: { soldCount: { increment: quantity } },
      });

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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Booking POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
