import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { paginationSchema, eventStatusField } from '@/lib/validations/common';
import { PERMISSIONS, hasPermission, getOrganizerPermissions } from '@/lib/permissions';
import { z } from 'zod';

const organizerEventsQuerySchema = z.object({
  page: paginationSchema.shape.page,
  limit: paginationSchema.shape.limit,
  status: eventStatusField.optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'STAFF', 'SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);

    const parsed = organizerEventsQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit, status } = parsed.data;

    // Build organizer IDs the user has access to
    let organizerIds: string[] = [];

    if (user.role === 'ORGANIZER' || user.role === 'SUPER_ADMIN') {
      // Get own organizer profile
      const profile = await db.organizerProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (profile) organizerIds.push(profile.id);

      // Also get memberships where user has events.view permission
      if (user.role !== 'SUPER_ADMIN') {
        const memberships = await db.organizerMembership.findMany({
          where: { userId: user.id, status: 'ACTIVE' },
          select: { organizerId: true, role: true, permissions: true },
        });
        for (const m of memberships) {
          const perms = getOrganizerPermissions(m);
          if (hasPermission(perms, PERMISSIONS.EVENTS_VIEW) && !organizerIds.includes(m.organizerId)) {
            organizerIds.push(m.organizerId);
          }
        }
      }
    } else if (user.role === 'STAFF') {
      // Staff members can see events through their memberships
      const memberships = await db.organizerMembership.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        select: { organizerId: true, role: true, permissions: true },
      });
      for (const m of memberships) {
        const perms = getOrganizerPermissions(m);
        if (hasPermission(perms, PERMISSIONS.EVENTS_VIEW)) {
          organizerIds.push(m.organizerId);
        }
      }
    }

    // For SUPER_ADMIN, they can also see events by their user.id as organizerId
    // (backward compat for events where organizerId = user.id)
    const where: Record<string, unknown> = {};
    if (organizerIds.length > 0) {
      // Find events owned by users whose organizer profiles match
      const profileUsers = await db.organizerProfile.findMany({
        where: { id: { in: organizerIds } },
        select: { userId: true },
      });
      const userIds = profileUsers.map(p => p.userId);
      // Also include user.id for direct ownership
      if (!userIds.includes(user.id)) userIds.push(user.id);
      where.organizerId = { in: userIds };
    } else {
      // Fallback to own events only
      where.organizerId = user.id;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      db.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          ticketTypes: {
            select: {
              id: true,
              name: true,
              price: true,
              quantity: true,
              soldCount: true,
              currency: true,
            },
          },
          _count: { select: { bookings: true, reviews: true } },
        },
      }),
      db.event.count({ where }),
    ]);

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
