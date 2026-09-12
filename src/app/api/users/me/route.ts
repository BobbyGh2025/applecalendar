import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateProfileSchema } from '@/lib/validations';

/**
 * GET /api/users/me — Retrieve the current user's profile.
 * Never returns the password hash.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    // Fetch fresh user data from DB (authenticate returns cached select)
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        phone: true,
        bio: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!fullUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    return NextResponse.json({ success: true, user: fullUser });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/users/me — Update the current user's profile.
 * Protected fields (id, email, role, isActive, password) cannot be modified here.
 * Email changes require a separate verification flow (Phase 2C).
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const body = await request.json();

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Ensure at least one field is provided
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No fields to update');
    }

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: updates,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        phone: true,
        bio: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    return handleApiError(error);
  }
}
