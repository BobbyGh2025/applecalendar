import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { paginationSchema } from '@/lib/validations';

/**
 * GET /api/admin/venues
 * List all venues across organizers. SUPER_ADMIN only.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);
    const parsed = paginationSchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit } = parsed.data;
    const search = searchParams.get('search') || '';
    const organizerId = searchParams.get('organizerId');

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
        { city: { contains: search } },
      ];
    }
    if (organizerId) {
      where.organizerId = organizerId;
    }

    const skip = (page - 1) * limit;

    const [venues, total] = await Promise.all([
      db.venue.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          city: true,
          state: true,
          country: true,
          capacity: true,
          isPublic: true,
          organizerId: true,
          organizer: { select: { id: true, name: true, email: true } },
          createdAt: true,
          _count: {
            select: { events: true },
          },
        },
      }),
      db.venue.count({ where }),
    ]);

    return NextResponse.json({
      venues,
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
