import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateToken, generateRefreshToken } from '@/lib/auth';
import { hash, compare } from 'bcryptjs';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { handleApiError, ApiError } from '@/lib/errors';
import { authSchema } from '@/lib/validations';
import { generateSecureToken, hashToken } from '@/lib/tokens';

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

      // Generate access token
      const token = await generateToken({ userId: user.id, email: user.email, role: user.role });

      // Generate refresh token
      const refreshToken = await generateRefreshToken({ userId: user.id, email: user.email, role: user.role });
      const refreshTokenHash = await hashToken(refreshToken);

      // Store refresh token in DB
      await db.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Generate email verification token
      const verificationToken = generateSecureToken();
      const verificationTokenHash = await hashToken(verificationToken);

      await db.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: verificationTokenHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // In development, return the verification token for testing
      const isDev = process.env.NODE_ENV !== 'production';

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
        refreshToken,
        ...(isDev && { verificationToken }), // Only in dev for testing
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

      // Generate access token
      const token = await generateToken({ userId: user.id, email: user.email, role: user.role });

      // Generate refresh token
      const refreshToken = await generateRefreshToken({ userId: user.id, email: user.email, role: user.role });
      const refreshTokenHash = await hashToken(refreshToken);

      // Store refresh token in DB
      await db.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

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
        refreshToken,
      });
    }

    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid action. Use "login" or "register"');
  } catch (error) {
    return handleApiError(error);
  }
}
