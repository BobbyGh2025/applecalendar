import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const bookings = await db.booking.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            startDate: true,
            venueName: true,
            status: true,
          },
        },
        tickets: {
          include: {
            ticketType: {
              select: { name: true, price: true, currency: true },
            },
          },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
          },
        },
      },
    });

    return NextResponse.json({ bookings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Bookings GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
