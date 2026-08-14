import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { paginationSchema, eventStatusField } from '@/lib/validations/common';
import { z } from 'zod';

const organizerEventsQuerySchema = z.object({
  page: paginationSchema.shape.page,
  limit: paginationSchema.shape.limit,
  status: eventStatusField.optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);

    const parsed = organizerEventsQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit, status } = parsed.data;

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
    return handleApiError(error);
  }
}
