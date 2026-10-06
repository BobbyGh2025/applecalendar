/**
 * GET /api/payments
 *
 * List payments (organizer/admin).
 * - Auth required + ORGANIZER or SUPER_ADMIN
 * - ORGANIZER sees payments for their events only
 * - SUPER_ADMIN sees all
 * - Paginated with optional status/provider filters
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { paymentQuerySchema } from '@/lib/validations/payments';
import { db } from '@/lib/db';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });

export async function GET(request: NextRequest) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    // Parse query params
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const parsed = paymentQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { status, provider, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (status) where.status = status;
    if (provider) where.provider = provider;

    // ORGANIZER: only payments for their events
    if (user.role === 'ORGANIZER') {
      where.booking = {
        event: {
          organizerId: user.id,
        },
      };
    }
    // SUPER_ADMIN: no filter — sees all

    const [payments, total] = await Promise.all([
      db.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          provider: true,
          status: true,
          providerRef: true,
          refundedAmount: true,
          expiresAt: true,
          completedAt: true,
          createdAt: true,
          booking: {
            select: {
              id: true,
              bookingRef: true,
              userId: true,
              event: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      }),
      db.payment.count({ where }),
    ]);

    return NextResponse.json({
      payments,
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
