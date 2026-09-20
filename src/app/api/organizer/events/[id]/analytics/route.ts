import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { PERMISSIONS, hasPermission, getOrganizerPermissions } from '@/lib/permissions';
import { getOrganizerEntitlements, getOrganizerEntitlementsById, requireAnalyticsLevel, requireOperableOrganizer } from '@/lib/services/entitlements';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'STAFF', 'SUPER_ADMIN')(user);
    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Ownership check: direct owner, SUPER_ADMIN, or staff member with analytics permission
    if (event.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      // Check membership with analytics.view permission
      const eventOwner = await db.user.findUnique({
        where: { id: event.organizerId },
        select: { organizerProfile: { select: { id: true } } },
      });

      if (!eventOwner?.organizerProfile) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this event\'s analytics');
      }

      const membership = await db.organizerMembership.findUnique({
        where: { organizerId_userId: { organizerId: eventOwner.organizerProfile.id, userId: user.id } },
      });

      if (!membership || membership.status !== 'ACTIVE') {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this event\'s analytics');
      }

      const perms = getOrganizerPermissions(membership);
      if (!hasPermission(perms, PERMISSIONS.ANALYTICS_VIEW)) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view analytics');
      }
    }

    // Phase 4B: Entitlement enforcement — check analytics level
    // The event organizer's subscription determines analytics depth.
    // FULL analytics (charts, daily breakdowns, ticket summary) requires ADVANCED level.
    if (user.role !== 'SUPER_ADMIN') {
      try {
        const ownerId = event.organizerId;
        const ownerProfile = await db.organizerProfile.findUnique({
          where: { userId: ownerId },
          select: { id: true },
        });
        if (ownerProfile) {
          const entitlements = await getOrganizerEntitlementsById(ownerProfile.id);
          requireOperableOrganizer(entitlements);
          // Detailed analytics endpoint provides full daily breakdown + ticket summary
          // Require at least ADVANCED analytics level
          requireAnalyticsLevel(entitlements, 'ADVANCED');
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // If entitlement check fails for non-obvious reasons, don't block access
        // but log the issue
      }
    }

    // Get last 30 days of analytics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const analytics = await db.eventAnalytics.findMany({
      where: {
        eventId: id,
        date: { gte: dateStr },
      },
      orderBy: { date: 'asc' },
    });

    // Fill missing dates with zeros
    const dailyAnalytics: Array<{
      date: string;
      views: number;
      clicks: number;
      bookings: number;
      revenue: number;
    }> = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const found = analytics.find((a) => a.date === key);
      dailyAnalytics.push({
        date: key,
        views: found?.views || 0,
        clicks: found?.clicks || 0,
        bookings: found?.bookings || 0,
        revenue: found?.revenue || 0,
      });
    }

    // Aggregate totals
    const totals = analytics.reduce(
      (acc, a) => ({
        views: acc.views + a.views,
        clicks: acc.clicks + a.clicks,
        bookings: acc.bookings + a.bookings,
        revenue: acc.revenue + a.revenue,
      }),
      { views: 0, clicks: 0, bookings: 0, revenue: 0 }
    );

    // Ticket sales summary
    const ticketSummary = await db.ticketType.findMany({
      where: { eventId: id },
      select: {
        name: true,
        price: true,
        quantity: true,
        soldCount: true,
        currency: true,
      },
    });

    return NextResponse.json({
      event: { id: event.id, title: event.title, slug: event.slug },
      analytics: dailyAnalytics,
      totals,
      ticketSummary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
