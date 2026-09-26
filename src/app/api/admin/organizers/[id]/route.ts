import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/admin/organizers/:id
 *
 * Get detailed organizer profile information.
 * SUPER_ADMIN only.
 *
 * Returns: profile, owner info, subscription, membership count,
 *          event count, recent audit logs.
 * Does NOT expose passwords or tokens.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const profile = await db.organizerProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        organizationName: true,
        slug: true,
        description: true,
        logo: true,
        coverImage: true,
        website: true,
        contactEmail: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        country: true,
        socialLinks: true,
        isVerified: true,
        approvalStatus: true,
        status: true,
        statusReason: true,
        statusChangedBy: true,
        statusChangedAt: true,
        createdAt: true,
        updatedAt: true,
        // Owner user info (no password or tokens)
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            phone: true,
            bio: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
          },
        },
        // Subscription details
        organizerSubscription: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            isInTrial: true,
            trialStart: true,
            trialEnd: true,
            autoRenew: true,
            billingProvider: true,
            paymentStatus: true,
            plan: {
              select: {
                id: true,
                slug: true,
                name: true,
                price: true,
                interval: true,
                maxEvents: true,
                maxTicketTypesPerEvent: true,
                maxStaff: true,
                canAdvertise: true,
                analyticsLevel: true,
              },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
    }

    // Parallel fetch: membership count, event count, recent audit logs
    const [membershipCount, eventCount, recentAuditLogs] = await Promise.all([
      db.organizerMembership.count({
        where: { organizerId: id, status: 'ACTIVE' },
      }),
      db.event.count({
        where: { organizerId: profile.userId },
      }),
      db.auditLog.findMany({
        where: { entityType: 'OrganizerProfile', entityId: id },
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorId: true,
          action: true,
          oldValue: true,
          newValue: true,
          reason: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      profile,
      membershipCount,
      eventCount,
      recentAuditLogs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
