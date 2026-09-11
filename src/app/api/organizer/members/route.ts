import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/organizer/members
 * List staff members of the authenticated organizer's organization.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const profile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found. Create your organization profile first.');
    }

    const members = await db.organizerMembership.findMany({
      where: { organizerId: profile.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { joinedAt: 'desc' },
    });

    // Also include the organizer owner as a virtual member
    const owner = {
      id: 'owner',
      role: 'OWNER',
      permissions: '[]',
      status: 'ACTIVE',
      joinedAt: profile.createdAt,
      user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar },
    };

    return NextResponse.json({ members: [owner, ...members] });
  } catch (error) {
    return handleApiError(error);
  }
}
