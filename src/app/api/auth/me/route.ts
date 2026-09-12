import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

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
        isActive: user.isActive,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
