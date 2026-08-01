import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

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

    const ticket = await db.ticket.findUnique({ where: { qrCode } });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
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
