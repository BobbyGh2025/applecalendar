import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateProfileSchema } from '@/lib/validations';

/**
 * GET /api/user/profile
 * Return the authenticated user's profile.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        phone: user.phone,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/user/profile
 * Update the authenticated user's profile (name, avatar, bio, phone).
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const body = await request.json();

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { name, avatar, bio, phone } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar || null;
    if (bio !== undefined) updateData.bio = bio;
    if (phone !== undefined) updateData.phone = phone;

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, avatar: true, bio: true, phone: true },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return handleApiError(error);
  }
}
