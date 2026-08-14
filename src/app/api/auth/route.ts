import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { hash, compare } from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email, password, name } = body;

    if (!action || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields: action, email, password' }, { status: 400 });
    }

    if (action === 'register') {
      if (!name) {
        return NextResponse.json({ error: 'Name is required for registration' }, { status: 400 });
      }

      const existingUser = await db.user.findUnique({ where: { email } });
      if (existingUser) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 400 });
      }

      const hashedPassword = await hash(password, 12);

      const user = await db.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role: 'PUBLIC',
        },
      });

      const token = await generateToken({ userId: user.id, email: user.email, role: user.role });

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
        token,
      }, { status: 201 });
    }

    if (action === 'login') {
      const user = await db.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
      }

      const isPasswordValid = await compare(password, user.password);
      if (!isPasswordValid) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
      }

      if (!user.isActive) {
        return NextResponse.json({ error: 'Account is deactivated' }, { status: 401 });
      }

      const token = await generateToken({ userId: user.id, email: user.email, role: user.role });

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
        token,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "login" or "register"' }, { status: 400 });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
