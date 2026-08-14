import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Dashboard endpoint
    if (type === 'dashboard') {
      const [
        myEvents,
        totalBookingsResult,
        totalRevenueResult,
        upcomingEvents,
        recentBookings,
      ] = await Promise.all([
        db.event.count({ where: { organizerId: user.id } }),
        db.booking.count({
          where: {
            event: { organizerId: user.id },
            status: { not: 'CANCELLED' },
          },
        }),
        db.payment.aggregate({
          _sum: { amount: true },
          where: {
            booking: { event: { organizerId: user.id } },
            status: 'COMPLETED',
          },
        }),
        db.event.findMany({
          where: {
            organizerId: user.id,
            status: 'PUBLISHED',
            startDate: { gte: new Date() },
          },
          take: 5,
          orderBy: { startDate: 'asc' },
          include: {
            category: { select: { name: true, slug: true } },
            ticketTypes: {
              select: {
                name: true,
                price: true,
                quantity: true,
                soldCount: true,
              },
            },
            _count: { select: { bookings: true, reviews: true } },
          },
        }),
        db.booking.findMany({
          where: {
            event: { organizerId: user.id },
          },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true } },
            event: { select: { id: true, title: true } },
            tickets: { select: { id: true, qrCode: true, status: true } },
          },
        }),
      ]);

      return NextResponse.json({
        myEvents,
        totalBookings: totalBookingsResult,
        totalRevenue: totalRevenueResult._sum.amount || 0,
        upcomingEvents,
        recentBookings,
      });
    }

    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid type parameter. Use "dashboard"');
  } catch (error) {
    return handleApiError(error);
  }
}
