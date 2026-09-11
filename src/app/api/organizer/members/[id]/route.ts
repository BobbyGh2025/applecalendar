import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateMemberSchema } from '@/lib/validations';

/**
 * PATCH /api/organizer/members/:id
 * Update a member's role, permissions, or status.
 * Only the organizer owner can update members.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: membershipId } = await params;

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const profile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
    }

    // Find the membership
    const membership = await db.organizerMembership.findUnique({
      where: { id: membershipId },
    });

    if (!membership || membership.organizerId !== profile.id) {
      throw new ApiError(404, 'NOT_FOUND', 'Member not found in your organization');
    }

    const body = await request.json();

    const parsed = updateMemberSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { role, permissions, status } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = JSON.stringify(permissions);
    if (status !== undefined) updateData.status = status;

    const updatedMembership = await db.organizerMembership.update({
      where: { id: membershipId },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    return NextResponse.json({ membership: updatedMembership });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/organizer/members/:id
 * Remove a member from the organization.
 * Only the organizer owner can remove members.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: membershipId } = await params;

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const profile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
    }

    // Find the membership
    const membership = await db.organizerMembership.findUnique({
      where: { id: membershipId },
    });

    if (!membership || membership.organizerId !== profile.id) {
      throw new ApiError(404, 'NOT_FOUND', 'Member not found in your organization');
    }

    // Soft delete: set status to REMOVED
    await db.organizerMembership.update({
      where: { id: membershipId },
      data: { status: 'REMOVED' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
