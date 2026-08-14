import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

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
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { isActive, role } = body;

    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (role !== undefined) {
      const validRoles = ['PUBLIC', 'ORGANIZER', 'STAFF', 'SUPER_ADMIN'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Admin User PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (existingUser.id === user.id) {
      return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
    }

    // Soft delete — set isActive to false
    await db.user.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ message: 'User deactivated successfully' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Admin User DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
