import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { hash, compare } from 'bcryptjs';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { handleApiError, ApiError } from '@/lib/errors';
import { authSchema } from '@/lib/validations';

const loginLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });
const registerLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = authSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { action, email, password } = parsed.data;

    if (action === 'register') {
      const rl = registerLimiter(request);
      if (!rl.success) {
        throw new RateLimitError(rl.remaining, rl.resetAt);
      }

      const { name } = parsed.data;

      const existingUser = await db.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new ApiError(409, 'CONFLICT', 'Email already registered');
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
      const rl = loginLimiter(request);
      if (!rl.success) {
        throw new RateLimitError(rl.remaining, rl.resetAt);
      }

      const user = await db.user.findUnique({ where: { email } });
      if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      }

      const isPasswordValid = await compare(password, user.password);
      if (!isPasswordValid) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      }

      if (!user.isActive) {
        throw new ApiError(403, 'FORBIDDEN', 'Account is deactivated');
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

    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid action. Use "login" or "register"');
  } catch (error) {
    return handleApiError(error);
  }
}
