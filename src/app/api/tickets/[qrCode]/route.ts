import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, AuthError } from '@/lib/auth';

async function verifyTicketAccess(userId: string, eventId: string, organizerId: string): Promise<boolean> {
  if (userId === organizerId) return true;
  const assignment = await db.staffAssignment.findUnique({
    where: { userId_eventId: { userId, eventId } },
  });
  return !!assignment;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'STAFF', 'SUPER_ADMIN')(user);
    const { qrCode } = await params;

    const ticket = await db.ticket.findUnique({
      where: { qrCode },
      include: {
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true,
            currency: true,
            event: { select: { id: true, organizerId: true } },
          },
        },
        booking: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            event: {
              select: {
                id: true,
                title: true,
                slug: true,
                startDate: true,
                venueName: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const eventId = ticket.ticketType.event.id;
    const organizerId = ticket.ticketType.event.organizerId;
    if (user.role !== 'SUPER_ADMIN' && !(await verifyTicketAccess(user.id, eventId, organizerId))) {
      return NextResponse.json({ error: 'You do not have permission to access this ticket' }, { status: 403 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Ticket GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'STAFF', 'SUPER_ADMIN')(user);
    const { qrCode } = await params;

    const ticket = await db.ticket.findUnique({
      where: { qrCode },
      include: {
        ticketType: {
          select: {
            id: true,
            name: true,
            event: { select: { id: true, organizerId: true } },
          },
        },
      },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const eventId = ticket.ticketType.event.id;
    const organizerId = ticket.ticketType.event.organizerId;
    if (user.role !== 'SUPER_ADMIN' && !(await verifyTicketAccess(user.id, eventId, organizerId))) {
      return NextResponse.json({ error: 'You do not have permission to check in this ticket' }, { status: 403 });
    }

    if (ticket.status === 'USED') {
      return NextResponse.json({ error: 'Ticket has already been used' }, { status: 400 });
    }

    if (ticket.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Ticket has been cancelled' }, { status: 400 });
    }

    if (ticket.status === 'EXPIRED') {
      return NextResponse.json({ error: 'Ticket has expired' }, { status: 400 });
    }

    const updatedTicket = await db.ticket.update({
      where: { qrCode },
      data: {
        status: 'USED',
        checkedInAt: new Date(),
      },
      include: {
        ticketType: {
          select: { name: true },
        },
        booking: {
          include: {
            user: { select: { name: true, email: true } },
            event: { select: { title: true } },
          },
        },
      },
    });

    return NextResponse.json({
      ticket: updatedTicket,
      message: 'Ticket checked in successfully',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Ticket PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
