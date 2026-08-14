import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);
    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    if (event.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this event\'s analytics');
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
