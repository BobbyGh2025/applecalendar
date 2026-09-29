import { NextRequest, NextResponse } from 'next/server';
import { authenticate, revokeSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * DELETE /api/users/me/sessions/:id — Revoke a specific session.
 *
 * Security:
 * - Only the session owner can revoke their own sessions
 * - Cross-user session access prevention: verifies session belongs to authenticated user
 * - Cannot revoke an already-revoked session (idempotent — returns success)
 * - Uses RefreshToken records as the session authority (no UserSession model)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: sessionId } = await params;

    if (!sessionId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Session ID is required');
    }

    // Verify the session belongs to this user (cross-user prevention)
    // RefreshToken records ARE the sessions — their id IS the session identifier
    const session = await db.refreshToken.findUnique({
      where: { id: sessionId },
      select: { userId: true, isRevoked: true },
    });

    if (!session) {
      throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    }

    if (session.userId !== user.id) {
      // Do not reveal existence of other users' sessions
      throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    }

    if (session.isRevoked) {
      // Idempotent — already revoked, return success
      return NextResponse.json({
        success: true,
        message: 'Session already revoked',
      });
    }

    await revokeSession(sessionId);

    return NextResponse.json({
      success: true,
      message: 'Session revoked successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
