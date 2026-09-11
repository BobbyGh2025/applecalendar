import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { refreshTokenSchema } from '@/lib/validations';
import { hashToken } from '@/lib/tokens';

/**
 * POST /api/auth/refresh
 * Refresh token rotation: verify refresh token, revoke old, issue new pair.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = refreshTokenSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { refreshToken } = parsed.data;

    // Verify the refresh token JWT
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token');
    }

    // Hash the token to look it up in the DB
    const tokenHash = await hashToken(refreshToken);

    // Find the stored refresh token
    const storedToken = await db.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.isRevoked || storedToken.expiresAt < new Date()) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token has been revoked or expired');
    }

    // Revoke the old token
    await db.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Get user
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
    });

    if (!user || !user.isActive) {
      throw new ApiError(401, 'UNAUTHORIZED', 'User not found or inactive');
    }

    // Generate new token pair
    const newAccessToken = await generateToken({ userId: user.id, email: user.email, role: user.role });
    const newRefreshToken = await generateRefreshToken({ userId: user.id, email: user.email, role: user.role });

    // Store the new refresh token hash
    const newTokenHash = await hashToken(newRefreshToken);
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json({
      user,
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
