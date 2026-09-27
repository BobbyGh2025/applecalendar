import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { getOperableOrganizerEntitlements, getEventUsage, requireWithinLimit, resolveOrganizerFromEvent } from '@/lib/services/entitlements';

const createTicketTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  price: z.number().min(0).default(0),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/).default('USD'),
  quantity: z.number().int().positive(),
  minPerOrder: z.number().int().min(1).default(1),
  maxPerOrder: z.number().int().min(1).default(10),
  saleStart: z.string().optional(),
  saleEnd: z.string().optional(),
  isActive: z.boolean().default(true),
}).refine(data => {
  // Phase 4G: minPerOrder cannot exceed maxPerOrder
  return data.minPerOrder <= data.maxPerOrder;
}, {
  message: 'minPerOrder cannot exceed maxPerOrder',
  path: ['minPerOrder'],
}).refine(data => {
  // Phase 4G: saleEnd must be after saleStart if both are set
  if (data.saleStart && data.saleEnd) {
    return new Date(data.saleEnd) > new Date(data.saleStart);
  }
  return true;
}, {
  message: 'Sale end date must be after sale start date',
  path: ['saleEnd'],
}).refine(data => {
  // Phase 4G: maxPerOrder cannot exceed quantity
  return data.maxPerOrder <= data.quantity;
}, {
  message: 'maxPerOrder cannot exceed quantity',
  path: ['maxPerOrder'],
});

/**
 * GET /api/events/:id/ticket-types
 * List ticket types for an event.
 * Public users see only active ticket types with safe fields.
 * Organizers/SUPER_ADMIN see all ticket types including soldCount.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Try to authenticate (optional for public access)
    let authenticatedUser: { id: string; role: string } | null = null;
    try {
      authenticatedUser = await authenticate(request);
    } catch {
      // Not authenticated — public access
    }

    const isOrganizer = authenticatedUser && (
      event.organizerId === authenticatedUser.id ||
      authenticatedUser.role === 'SUPER_ADMIN'
    );

    const ticketTypes = await db.ticketType.findMany({
      where: {
        eventId,
        ...(!isOrganizer && { isActive: true }), // Public only sees active
      },
      orderBy: { price: 'asc' },
    });

    // Phase 4G: Public users see safe ticket information only
    if (!isOrganizer) {
      const publicTicketTypes = ticketTypes.map(tt => ({
        id: tt.id,
        name: tt.name,
        description: tt.description,
        price: tt.price,
        currency: tt.currency,
        quantity: tt.quantity,
        soldCount: tt.soldCount, // needed for "X of Y remaining" display
        minPerOrder: tt.minPerOrder,
        maxPerOrder: tt.maxPerOrder,
        saleStart: tt.saleStart,
        saleEnd: tt.saleEnd,
        isActive: tt.isActive,
        // Internal fields (eventId) excluded
      }));
      return NextResponse.json({ ticketTypes: publicTicketTypes });
    }

    return NextResponse.json({ ticketTypes });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/events/:id/ticket-types
 * Add a ticket type to an existing event.
 * Owner or SUPER_ADMIN only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Authenticate → Authorize → Verify ownership
    if (event.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to manage ticket types for this event');
    }

    // Phase 4B: Entitlement enforcement — check ticket type count limit
    // Phase 4D: Also enforce maxTicketsPerEvent (total ticket capacity)
    if (user.role !== 'SUPER_ADMIN') {
      const organizerId = await resolveOrganizerFromEvent(event.organizerId);
      if (organizerId) {
        const entitlements = await getOperableOrganizerEntitlements(user.id);
        const eventUsage = await getEventUsage(eventId);
        requireWithinLimit(eventUsage.ticketTypes, entitlements.limits.maxTicketTypesPerEvent, 'ticket types per event', entitlements.planSlug);
      }
    }

    const body = await request.json();
    const parsed = createTicketTypeSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Phase 4D: Enforce maxTicketsPerEvent — total ticket capacity across all ticket types
    // maxTicketsPerEvent limits the sum of all TicketType.quantity for a single event.
    // Enforcement point: when creating a new ticket type.
    if (user.role !== 'SUPER_ADMIN') {
      const entitlements = await getOperableOrganizerEntitlements(user.id);
      // Get current total ticket capacity for this event
      const currentCapacity = await db.ticketType.aggregate({
        where: { eventId },
        _sum: { quantity: true },
      });
      const totalCapacity = (currentCapacity._sum.quantity || 0) + parsed.data.quantity;
      if (totalCapacity > entitlements.limits.maxTicketsPerEvent) {
        throw new ApiError(403, 'PLAN_LIMIT_REACHED', 'Adding this ticket type would exceed the ticket capacity limit for your plan', {
          limit: 'maxTicketsPerEvent*',
          current: currentCapacity._sum.quantity || 0,
          requested: parsed.data.quantity,
          max: entitlements.limits.maxTicketsPerEvent,
          planSlug: entitlements.planSlug,
        });
      }
    }

    const ticketType = await db.ticketType.create({
      data: {
        eventId,
        ...parsed.data,
        saleStart: parsed.data.saleStart ? new Date(parsed.data.saleStart) : null,
        saleEnd: parsed.data.saleEnd ? new Date(parsed.data.saleEnd) : null,
      },
    });

    return NextResponse.json({ ticketType }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
