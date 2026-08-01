import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '12', 10);
    const status = searchParams.get('status') || '';

    const where: Record<string, unknown> = { organizerId: user.id };
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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Organizer Events GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
