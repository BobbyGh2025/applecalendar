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
});

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

    // Phase 4B: Entitlement enforcement — check ticket type limit
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
