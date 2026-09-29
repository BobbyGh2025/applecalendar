import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { getOperableOrganizerEntitlements, resolveOrganizerFromEvent } from '@/lib/services/entitlements';

const updateTicketTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  price: z.number().int('Price must be an integer (minor units)').min(0).optional(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/).optional(),
  quantity: z.number().int().positive().optional(),
  minPerOrder: z.number().int().min(1).optional(),
  maxPerOrder: z.number().int().min(1).optional(),
  saleStart: z.string().optional(),
  saleEnd: z.string().optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /api/events/:id/ticket-types/:ttId
 * Update a ticket type. Owner or SUPER_ADMIN only.
 * Cannot reduce quantity below soldCount.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ttId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, ttId } = await params;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    if (event.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to manage ticket types for this event');
    }

    const existing = await db.ticketType.findFirst({
      where: { id: ttId, eventId },
    });
    if (!existing) {
      throw new ApiError(404, 'NOT_FOUND', 'Ticket type not found');
    }

    const body = await request.json();
    const parsed = updateTicketTypeSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Cannot reduce quantity below soldCount
    if (parsed.data.quantity !== undefined && parsed.data.quantity < existing.soldCount) {
      throw new ApiError(
        400,
        'SOLD_COUNT_EXCEEDED',
        `Cannot reduce quantity below ${existing.soldCount} (already sold)`
      );
    }

    // Phase 4G: Cross-field validation — minPerOrder/maxPerOrder consistency
    const effectiveMin = parsed.data.minPerOrder ?? existing.minPerOrder;
    const effectiveMax = parsed.data.maxPerOrder ?? existing.maxPerOrder;
    if (effectiveMin > effectiveMax) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'minPerOrder cannot exceed maxPerOrder'
      );
    }

    // Phase 4G: maxPerOrder cannot exceed quantity
    const effectiveQuantity = parsed.data.quantity ?? existing.quantity;
    if (effectiveMax > effectiveQuantity) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'maxPerOrder cannot exceed quantity'
      );
    }

    // Phase 4G: Sale window validation — saleEnd must be after saleStart
    const effectiveSaleStart = parsed.data.saleStart !== undefined
      ? (parsed.data.saleStart ? new Date(parsed.data.saleStart) : null)
      : existing.saleStart;
    const effectiveSaleEnd = parsed.data.saleEnd !== undefined
      ? (parsed.data.saleEnd ? new Date(parsed.data.saleEnd) : null)
      : existing.saleEnd;
    if (effectiveSaleStart && effectiveSaleEnd && effectiveSaleEnd <= effectiveSaleStart) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Sale end date must be after sale start date'
      );
    }

    // Phase 4D Closure: Enforce maxTicketsPerEvent when quantity is increased.
    // Without this check, an organizer could CREATE a ticket type with a small
    // quantity (passing the CREATE-time check), then PATCH the quantity to
    // exceed the plan limit — a bypass of the entitlement system.
    if (parsed.data.quantity !== undefined && user.role !== 'SUPER_ADMIN') {
      const organizerId = await resolveOrganizerFromEvent(event.organizerId);
      if (organizerId) {
        const entitlements = await getOperableOrganizerEntitlements(user.id);
        // Get total capacity of ALL OTHER ticket types for this event (excluding this one)
        const otherCapacity = await db.ticketType.aggregate({
          where: { eventId, id: { not: ttId } },
          _sum: { quantity: true },
        });
        const newTotalCapacity = (otherCapacity._sum.quantity || 0) + parsed.data.quantity;
        if (newTotalCapacity > entitlements.limits.maxTicketsPerEvent) {
          throw new ApiError(403, 'PLAN_LIMIT_REACHED', 'Updating this ticket type would exceed the ticket capacity limit for your plan', {
            limit: 'maxTicketsPerEvent',
            current: (otherCapacity._sum.quantity || 0) + existing.quantity,
            requested: newTotalCapacity,
            max: entitlements.limits.maxTicketsPerEvent,
            planSlug: entitlements.planSlug,
          });
        }
      }
    }

    const updateData: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.saleStart !== undefined) {
      updateData.saleStart = parsed.data.saleStart ? new Date(parsed.data.saleStart) : null;
    }
    if (parsed.data.saleEnd !== undefined) {
      updateData.saleEnd = parsed.data.saleEnd ? new Date(parsed.data.saleEnd) : null;
    }

    const ticketType = await db.ticketType.update({
      where: { id: ttId },
      data: updateData,
    });

    return NextResponse.json({ ticketType });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/events/:id/ticket-types/:ttId
 * Delete a ticket type. Owner or SUPER_ADMIN only.
 * Cannot delete if tickets have been sold.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ttId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, ttId } = await params;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    if (event.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to manage ticket types for this event');
    }

    const existing = await db.ticketType.findFirst({
      where: { id: ttId, eventId },
    });
    if (!existing) {
      throw new ApiError(404, 'NOT_FOUND', 'Ticket type not found');
    }

    // Cannot delete if tickets have been sold (preserves transactional history)
    if (existing.soldCount > 0) {
      throw new ApiError(
        400,
        'HAS_SOLD_TICKETS',
        `Cannot delete ticket type with ${existing.soldCount} tickets sold. Deactivate it instead.`
      );
    }

    await db.ticketType.delete({ where: { id: ttId } });

    return NextResponse.json({ success: true, message: 'Ticket type deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
