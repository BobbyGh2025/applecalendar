import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { usersQuerySchema, paginationSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Dashboard stats endpoint
    if (type === 'stats') {
      const parsed = paginationSchema.safeParse(searchParams);
      if (!parsed.success) {
        return ApiError.fromZodError(parsed.error).toResponse();
      }

      const [
        totalUsers,
        totalEvents,
        totalBookings,
        totalRevenueResult,
        recentUsers,
        recentEvents,
        eventsByStatus,
      ] = await Promise.all([
        db.user.count(),
        db.event.count(),
        db.booking.count({ where: { status: { not: 'CANCELLED' } } }),
        db.payment.aggregate({ _sum: { amount: true }, where: { status: 'COMPLETED' } }),
        db.user.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, email: true, role: true, avatar: true, createdAt: true },
        }),
        db.event.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            category: { select: { name: true, slug: true } },
            organizer: { select: { name: true } },
          },
        }),
        db.event.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
      ]);

      // Revenue by month (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const paymentsByMonth = await db.payment.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: sixMonthsAgo },
        },
        select: { amount: true, createdAt: true },
      });

      const revenueByMonth: Record<string, number> = {};
      for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        revenueByMonth[key] = 0;
      }

      for (const payment of paymentsByMonth) {
        const key = `${payment.createdAt.getFullYear()}-${String(payment.createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (revenueByMonth[key] !== undefined) {
          revenueByMonth[key] += payment.amount;
        }
      }

      return NextResponse.json({
        totalUsers,
        totalEvents,
        totalBookings,
        totalRevenue: totalRevenueResult._sum.amount || 0,
        recentUsers,
        recentEvents,
        eventsByStatus: eventsByStatus.map((e) => ({ status: e.status, count: e._count.status })),
        revenueByMonth,
      });
    }

    // Users list endpoint
    if (type === 'users') {
      const parsed = usersQuerySchema.safeParse(searchParams);
      if (!parsed.success) {
        return ApiError.fromZodError(parsed.error).toResponse();
      }

      const { page, limit, search = '', role } = parsed.data;

      const where: Record<string, unknown> = {};
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { email: { contains: search } },
        ];
      }
      if (role) {
        where.role = role;
      }

      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
            phone: true,
            bio: true,
            isActive: true,
            createdAt: true,
            _count: { select: { bookings: true } },
          },
        }),
        db.user.count({ where }),
      ]);

      return NextResponse.json({
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid type parameter. Use "stats" or "users"');
  } catch (error) {
    return handleApiError(error);
  }
}
