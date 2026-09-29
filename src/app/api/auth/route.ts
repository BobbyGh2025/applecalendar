import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSessionAndTokens } from '@/lib/auth';
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

      // Create session with consolidated helper
      const session = await createSessionAndTokens({
        userId: user.id,
        email: user.email,
        role: user.role,
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

      // Log audit event for registration
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'REGISTER',
          entityType: 'User',
          entityId: user.id,
          newValue: JSON.stringify({ email: user.email, role: user.role }),
        },
      }).catch(() => {}); // Non-blocking — don't fail registration if audit log fails

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
        token: session.accessToken,
        refreshToken: session.refreshToken,
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
        // Log failed login attempt (unknown email)
        await db.auditLog.create({
          data: {
            action: 'LOGIN_FAILED',
            entityType: 'User',
            entityId: email,
            newValue: JSON.stringify({ reason: 'email_not_found' }),
          },
        }).catch(() => {});

        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      }

      const isPasswordValid = await compare(password, user.password);
      if (!isPasswordValid) {
        // Log failed login attempt (wrong password)
        await db.auditLog.create({
          data: {
            actorId: user.id,
            action: 'LOGIN_FAILED',
            entityType: 'User',
            entityId: user.id,
            newValue: JSON.stringify({ reason: 'invalid_password' }),
          },
        }).catch(() => {});

        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      }

      if (!user.isActive) {
        throw new ApiError(403, 'FORBIDDEN', 'Account is deactivated');
      }

      // Create session with consolidated helper
      const session = await createSessionAndTokens({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // Log successful login
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'LOGIN',
          entityType: 'User',
          entityId: user.id,
          newValue: JSON.stringify({ sessionId: session.sessionId }),
        },
      }).catch(() => {}); // Non-blocking

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
        token: session.accessToken,
        refreshToken: session.refreshToken,
      });
    }

    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid action. Use "login" or "register"');
  } catch (error) {
    return handleApiError(error);
  }
}
