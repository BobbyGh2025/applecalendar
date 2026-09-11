import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

// ─── Lazy JWT Secret (Part B: Fix module-level throw) ───

let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  // Re-read from env if cached value is stale (e.g. test environment changes)
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  const encoded = new TextEncoder().encode(secret);
  // Only cache if we have a valid value
  if (!_jwtSecret) _jwtSecret = encoded;
  return _jwtSecret;
}

/** Reset cached JWT secret (for test environments only) */
export function _resetJwtSecret() {
  _jwtSecret = null;
}

// ─── AuthError ───

class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ─── Access Token (15 min expiry) ───

export async function generateToken(payload: { userId: string; email: string; role: string }) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getJwtSecret());
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // Reject refresh tokens used as access tokens
    if (payload.type === 'refresh') return null;
    return payload as { userId: string; email: string; role: string; iat: number; exp: number };
  } catch {
    return null;
  }
}

// ─── Refresh Token (7 day expiry) ───

export async function generateRefreshToken(payload: { userId: string; email: string; role: string }) {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

export async function verifyRefreshToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.type !== 'refresh') return null;
    return payload as { userId: string; email: string; role: string; type: string; iat: number; exp: number };
  } catch {
    return null;
  }
}

// ─── Authenticate (access token) ───

export async function authenticate(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Authentication required');
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) {
    throw new AuthError('Invalid or expired token');
  }

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
  });

  if (!user || !user.isActive) {
    throw new AuthError('User not found or inactive');
  }

  return user;
}

// ─── Authenticate with refresh token ───

export async function authenticateWithRefresh(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Authentication required');
  }

  const token = authHeader.slice(7);
  const payload = await verifyRefreshToken(token);
  if (!payload) {
    throw new AuthError('Invalid or expired refresh token');
  }

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
  });

  if (!user || !user.isActive) {
    throw new AuthError('User not found or inactive');
  }

  return { user, refreshToken: token };
}

// ─── Role checks ───

export function requireRole(...roles: string[]) {
  return (user: { role: string }) => {
    if (!roles.includes(user.role)) {
      throw new AuthError('Insufficient permissions', 403);
    }
    return user;
  };
}

/**
 * Require the user to be an ORGANIZER or SUPER_ADMIN.
 */
export function requireOrganizerOrAdmin(user: { role: string }) {
  if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
    throw new AuthError('Organizer or admin access required', 403);
  }
  return user;
}

/**
 * Check if a user is a member of an organizer's organization.
 * Returns the membership if found, throws otherwise.
 */
export async function requireOrganizerMembership(userId: string, organizerId: string) {
  const membership = await db.organizerMembership.findUnique({
    where: { organizerId_userId: { organizerId, userId } },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw new AuthError('You are not an active member of this organization', 403);
  }

  return membership;
}

// ─── Refresh Token Rotation ───

/**
 * Rotate refresh token: revoke old, create new pair.
 */
export async function rotateRefreshToken(oldTokenHash: string, userId: string) {
  // Revoke the old refresh token
  await db.refreshToken.updateMany({
    where: { tokenHash: oldTokenHash, userId },
    data: { isRevoked: true },
  });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
  });

  if (!user) throw new AuthError('User not found');

  // Generate new token pair
  const newAccessToken = await generateToken({ userId: user.id, email: user.email, role: user.role });
  const newRefreshToken = await generateRefreshToken({ userId: user.id, email: user.email, role: user.role });

  return { user, token: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * Revoke all refresh tokens for a user (logout / password change).
 */
export async function revokeAllRefreshTokens(userId: string) {
  await db.refreshToken.updateMany({
    where: { userId },
    data: { isRevoked: true },
  });
}

export { AuthError };
