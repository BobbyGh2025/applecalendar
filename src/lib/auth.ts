import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET environment variable is required');
const JWT_SECRET = new TextEncoder().encode(secret);

class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function generateToken(payload: { userId: string; email: string; role: string }) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; email: string; role: string; iat: number; exp: number };
  } catch {
    return null;
  }
}

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

export function requireRole(...roles: string[]) {
  return (user: { role: string }) => {
    if (!roles.includes(user.role)) {
      throw new AuthError('Insufficient permissions', 403);
    }
    return user;
  };
}

export { AuthError };
