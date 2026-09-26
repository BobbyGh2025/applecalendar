import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/admin/organizers
 *
 * List all organizer profiles with filtering and pagination.
 * SUPER_ADMIN only.
 *
 * Query params:
 *   status  - filter by lifecycle status (PENDING_APPROVAL, ACTIVE, REJECTED, SUSPENDED, DEACTIVATED)
 *   search  - search by organization name or contact email
 *   page    - page number (default 1)
 *   limit   - items per page (default 12, max 100)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '12', 10) || 12));

    // Build where clause
    const where: Record<string, unknown> = {};

    if (status) {
      const validStatuses = ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'];
      if (!validStatuses.includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Invalid status filter. Valid values: ${validStatuses.join(', ')}`);
      }
      where.status = status;
    }

    if (search) {
      where.OR = [
        { organizationName: { contains: search } },
        { contactEmail: { contains: search } },
        { slug: { contains: search } },
      ];
    }

    const skip = (page - 1) * limit;

    const [organizers, total] = await Promise.all([
      db.organizerProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          organizationName: true,
          slug: true,
          logo: true,
          contactEmail: true,
          phone: true,
          city: true,
          country: true,
          isVerified: true,
          approvalStatus: true,
          status: true,
          statusReason: true,
          statusChangedAt: true,
          createdAt: true,
          updatedAt: true,
          // Owner user info
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          // Subscription summary
          organizerSubscription: {
            select: {
              id: true,
              status: true,
              plan: {
                select: {
                  slug: true,
                  name: true,
                },
              },
              endDate: true,
              isInTrial: true,
            },
          },
          // Counts
          _count: {
            select: {
              memberships: { where: { status: 'ACTIVE' } },
              invitations: { where: { acceptedAt: null } },
            },
          },
        },
      }),
      db.organizerProfile.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      organizers,
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
