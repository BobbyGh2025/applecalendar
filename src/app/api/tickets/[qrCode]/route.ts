import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';

const ticketLookupLimiter = rateLimit({ windowMs: 60_000, maxRequests: 30 });
const ticketCheckinLimiter = rateLimit({ windowMs: 60_000, maxRequests: 15 });

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
    const rl = ticketLookupLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

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
      throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');
    }

    const eventId = ticket.ticketType.event.id;
    const organizerId = ticket.ticketType.event.organizerId;
    if (user.role !== 'SUPER_ADMIN' && !(await verifyTicketAccess(user.id, eventId, organizerId))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this ticket');
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const rl = ticketCheckinLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

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
      throw new ApiError(404, 'NOT_FOUND', 'Ticket not found');
    }

    const eventId = ticket.ticketType.event.id;
    const organizerId = ticket.ticketType.event.organizerId;
    if (user.role !== 'SUPER_ADMIN' && !(await verifyTicketAccess(user.id, eventId, organizerId))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to check in this ticket');
    }

    if (ticket.status === 'USED') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket has already been used');
    }

    if (ticket.status === 'CANCELLED') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket has been cancelled');
    }

    if (ticket.status === 'EXPIRED') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket has expired');
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
    return handleApiError(error);
  }
}
