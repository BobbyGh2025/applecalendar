import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

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
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, imageUrl, linkUrl, position, status, startDate, endDate } = body;

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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Ad PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    await db.advertisement.delete({ where: { id } });

    return NextResponse.json({ message: 'Ad deleted successfully' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Ad DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
