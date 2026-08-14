import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateUserSchema } from '@/lib/validations';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const existingUser = await db.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    const body = await request.json();

    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { isActive, role } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (role !== undefined) {
      // Prevent granting SUPER_ADMIN to users who don't already have it
      if (role === 'SUPER_ADMIN' && existingUser.role !== 'SUPER_ADMIN') {
        throw new ApiError(403, 'FORBIDDEN', 'Cannot grant SUPER_ADMIN role');
      }
      updateData.role = role;
    }

    const updatedUser = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        phone: true,
        bio: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const existingUser = await db.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    if (existingUser.id === user.id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot deactivate your own account');
    }

    // Soft delete — set isActive to false
    await db.user.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
