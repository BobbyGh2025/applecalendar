import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateAdSchema } from '@/lib/validations';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);
    const { id } = await params;

    const existingAd = await db.advertisement.findUnique({ where: { id } });
    if (!existingAd) {
      throw new ApiError(404, 'NOT_FOUND', 'Ad not found');
    }

    if (user.role !== 'SUPER_ADMIN' && existingAd.advertiserId !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to update this ad');
    }

    const body = await request.json();

    const parsed = updateAdSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { title, imageUrl, linkUrl, position, status, startDate, endDate } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (linkUrl !== undefined) updateData.linkUrl = linkUrl;
    if (position !== undefined) updateData.position = position;
    if (status !== undefined) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    const ad = await db.advertisement.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ ad });
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
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);
    const { id } = await params;

    const existingAd = await db.advertisement.findUnique({ where: { id } });
    if (!existingAd) {
      throw new ApiError(404, 'NOT_FOUND', 'Ad not found');
    }

    if (user.role !== 'SUPER_ADMIN' && existingAd.advertiserId !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to delete this ad');
    }

    await db.advertisement.delete({ where: { id } });

    return NextResponse.json({ success: true, message: 'Ad deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
