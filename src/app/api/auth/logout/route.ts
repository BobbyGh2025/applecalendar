import { NextRequest, NextResponse } from 'next/server';
import { authenticate, revokeAllRefreshTokens } from '@/lib/auth';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/errors';

/**
 * POST /api/auth/logout
 * Logout: revoke all refresh tokens for the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    await revokeAllRefreshTokens(user.id);

    // Log logout event
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: user.id,
      },
    }).catch(() => {}); // Non-blocking

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
