import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { hashToken, generateSecureToken } from '@/lib/tokens';

// ─── Constants ───

/** Access token expiry: 15 minutes */
const ACCESS_TOKEN_EXPIRY = '15m';

/** Access token expiry in seconds */
const ACCESS_TOKEN_EXPIRY_SECONDS = 900;

/** Refresh token expiry: 7 days */
const REFRESH_TOKEN_EXPIRY = '7d';

/** Refresh token expiry in milliseconds */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Lazy JWT Secret ───

let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
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

// ─── Types ───

/** Access token JWT payload */
export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: string;
  type: 'access';
  sessionId: string; // RefreshToken.id — the persistent session identifier
  iat: number;
  exp: number;
}

/** Refresh token JWT payload */
export interface RefreshTokenPayload {
  userId: string;
  email: string;
  role: string;
  type: 'refresh';
  sessionId: string; // RefreshToken.id
  iat: number;
  exp: number;
}

/** Result of creating a session (login/register) */
export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string; // RefreshToken.id
  expiresIn: number; // seconds until access token expires
}

/** Result of refreshing a session */
export interface RefreshResult {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

/** Active session info for listing */
export interface ActiveSession {
  id: string; // RefreshToken.id (the session identifier)
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

// ─── AuthError ───

class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

export { AuthError };

// ─── Token Generation ───

/**
 * Generate an access token with type='access' and sessionId.
 * The sessionId is the RefreshToken.id — the persistent session identifier.
 */
export async function generateToken(payload: { userId: string; email: string; role: string; sessionId: string }) {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

/**
 * Generate a refresh token with type='refresh' and sessionId.
 * The sessionId is the RefreshToken.id — the persistent session identifier.
 */
export async function generateRefreshToken(payload: { userId: string; email: string; role: string; sessionId: string }) {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

// ─── Token Verification ───

/**
 * Verify an access token JWT.
 * Returns the decoded payload or null if invalid/expired/wrong type.
 */
export async function verifyToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // Must be an access token
    if (payload.type !== 'access') return null;
    return payload as unknown as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token JWT.
 * Returns the decoded payload or null if invalid/expired/wrong type.
 */
export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.type !== 'refresh') return null;
    return payload as unknown as RefreshTokenPayload;
  } catch {
    return null;
  }
}

// ─── Session Creation (consolidated) ───

/**
 * Create a new session with access and refresh tokens.
 *
 * This is the consolidated entry point for login and registration.
 * It:
 * 1. Creates a RefreshToken record in the database
 * 2. Generates an access token with sessionId = RefreshToken.id
 * 3. Generates a refresh token with sessionId = RefreshToken.id
 *
 * The RefreshToken.id becomes the session identifier, embedded in both JWTs.
 *
 * @param params - User identification and optional metadata
 * @returns SessionResult with both tokens and the sessionId
 */
export async function createSessionAndTokens(params: {
  userId: string;
  email: string;
  role: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<SessionResult> {
  const { userId, email, role } = params;

  // 1. Create a placeholder RefreshToken record to get its ID
  // We'll update the tokenHash after generating the refresh token
  const refreshTokenRecord = await db.refreshToken.create({
    data: {
      userId,
      tokenHash: `pending:${generateSecureToken()}`, // Will be updated below — unique placeholder to avoid constraint violation
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  const sessionId = refreshTokenRecord.id;

  // 2. Generate tokens with sessionId embedded
  const accessToken = await generateToken({ userId, email, role, sessionId });
  const refreshToken = await generateRefreshToken({ userId, email, role, sessionId });

  // 3. Hash the refresh token and update the record
  const refreshTokenHash = await hashToken(refreshToken);
  await db.refreshToken.update({
    where: { id: sessionId },
    data: { tokenHash: refreshTokenHash },
  });

  return {
    accessToken,
    refreshToken,
    sessionId,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  };
}

// ─── Access Token Verification (consolidated) ───

/**
 * Verify an access token and check that its session is still valid.
 *
 * This goes beyond JWT verification — it also checks:
 * 1. The JWT is valid and not expired
 * 2. The session (RefreshToken record) has not been revoked
 * 3. The user still exists and is active
 *
 * Returns the payload if valid, or null if invalid/revoked.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  const payload = await verifyToken(token);
  if (!payload) return null;

  // Validate sessionId claim exists — tokens without it are rejected
  if (!payload.sessionId) return null;

  // Check that the session hasn't been revoked
  const session = await db.refreshToken.findUnique({
    where: { id: payload.sessionId },
    select: { isRevoked: true },
  });

  if (!session || session.isRevoked) return null;

  return payload;
}

// ─── Session Refresh (consolidated) ───

/**
 * Refresh a session using a raw refresh token string.
 *
 * This is the consolidated refresh flow:
 * 1. Verify the refresh token JWT
 * 2. Look up the stored RefreshToken record by hash
 * 3. Verify it's not revoked or expired
 * 4. Revoke the old refresh token (rotation)
 * 5. Create a new session (new RefreshToken record + new token pair)
 *
 * @param rawRefreshToken - The raw refresh token string from the client
 * @returns RefreshResult with new tokens
 * @throws Error if the refresh token is invalid, revoked, or expired
 */
export async function refreshSession(rawRefreshToken: string): Promise<RefreshResult> {
  // 1. Verify the JWT
  const payload = await verifyRefreshToken(rawRefreshToken);
  if (!payload) {
    throw new AuthError('Invalid or expired refresh token');
  }

  // 2. Look up the stored token by hash
  const tokenHashFromRaw = await hashToken(rawRefreshToken);
  const storedToken = await db.refreshToken.findUnique({
    where: { tokenHash: tokenHashFromRaw },
  });

  if (!storedToken) {
    throw new AuthError('Session not found');
  }

  if (storedToken.isRevoked) {
    throw new AuthError('Session has been revoked');
  }

  if (storedToken.expiresAt < new Date()) {
    throw new AuthError('Session has expired');
  }

  // 3. Revoke the old token atomically (rotation + concurrent-refresh protection)
  //    Using updateMany with `isRevoked: false` ensures that if two concurrent
  //    requests both validate the same refresh token, only the first one to reach
  //    this line will see count=1 and proceed. The second will see count=0 and fail.
  const revokeResult = await db.refreshToken.updateMany({
    where: { id: storedToken.id, isRevoked: false },
    data: { isRevoked: true },
  });
  if (revokeResult.count === 0) {
    throw new AuthError('Session has been revoked');
  }

  // 4. Verify user is still active
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
  });

  if (!user || !user.isActive) {
    throw new AuthError('User not found or inactive');
  }

  // 5. Create a new session
  const newSession = await createSessionAndTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    success: true,
    accessToken: newSession.accessToken,
    refreshToken: newSession.refreshToken,
    sessionId: newSession.sessionId,
    expiresIn: newSession.expiresIn,
  };
}

// ─── Authenticate (middleware for API routes) ───

/**
 * Authenticate a request using the Bearer access token.
 * Verifies the JWT and checks the session is not revoked.
 */
export async function authenticate(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Authentication required');
  }

  const token = authHeader.slice(7);
  const payload = await verifyAccessToken(token);
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

// ─── Session Revocation ───

/**
 * Revoke a specific session by its ID (RefreshToken.id).
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await db.refreshToken.update({
    where: { id: sessionId },
    data: { isRevoked: true },
  });
}

/**
 * Revoke all refresh tokens (sessions) for a user.
 * Used for logout-all, password change, and password reset.
 * Returns the count of revoked sessions.
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId },
    data: { isRevoked: true },
  });
}

/**
 * Revoke all sessions for a user. Alias for revokeAllRefreshTokens
 * that returns the count of revoked sessions.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });
  return result.count;
}

/**
 * Revoke all sessions except the current one.
 */
export async function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { userId, id: { not: currentSessionId }, isRevoked: false },
    data: { isRevoked: true },
  });
  return result.count;
}

// ─── Session Listing ───

/**
 * Extract session ID from the access token in the authorization header.
 * Returns the sessionId claim from the JWT, or null if not available.
 */
export async function extractSessionId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  return payload?.sessionId ?? null;
}

/**
 * List all active sessions for a user.
 * Each session includes an isCurrent flag if it matches the currentSessionId.
 */
export async function listActiveSessions(userId: string, currentSessionId?: string): Promise<ActiveSession[]> {
  const tokens = await db.refreshToken.findMany({
    where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, expiresAt: true },
  });

  return tokens.map(t => ({
    id: t.id,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    isCurrent: t.id === currentSessionId,
  }));
}

// ─── Session Cleanup ───

/**
 * Delete expired and revoked refresh token records.
 * Called periodically for housekeeping.
 * Returns the number of deleted records.
 */
export async function cleanupSessions(): Promise<number> {
  const result = await db.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true },
      ],
    },
  });
  return result.count;
}

// ─── Legacy compatibility ───

/**
 * Rotate refresh token: revoke old, create new pair.
 * @deprecated Use refreshSession() instead for the full consolidated flow.
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

  const session = await createSessionAndTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return { user, token: session.accessToken, refreshToken: session.refreshToken };
}
