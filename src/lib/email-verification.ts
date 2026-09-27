import crypto from 'crypto';
import { db } from '@/lib/db';
import { hashToken } from '@/lib/tokens';

// ─── Configuration ───

/** Verification token expires in 24 hours */
const VERIFICATION_TOKEN_TTL_HOURS = 24;

// ─── Token generation ───

/**
 * Generate a cryptographically secure verification token and store its hash in the database.
 * Returns the RAW token — this is the only time it exists in plaintext.
 * The raw token should be sent to the user via email (or returned in dev mode).
 *
 * Any previous unused tokens for this user are invalidated (marked usedAt)
 * to ensure only the latest token is valid.
 */
export async function createEmailVerificationToken(userId: string): Promise<string> {
  // Invalidate any previous unused tokens for this user
  await db.emailVerificationToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  // Generate a crypto-secure token (64 hex chars = 32 bytes of entropy)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await hashToken(rawToken);

  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return rawToken;
}

// ─── Token verification ───

export interface VerifyEmailResult {
  success: boolean;
  alreadyVerified?: boolean;
  message: string;
}

/**
 * Verify an email using a raw verification token.
 *
 * Security properties:
 * - Token is hashed before DB lookup (timing-safe comparison via hash match)
 * - Expired tokens are rejected
 * - Used tokens are rejected (one-time consumption)
 * - Anti-enumeration: same generic message for invalid/expired/used tokens
 * - Sets user.emailVerified = now() on success
 * - Marks token.usedAt = now() on success
 * - Does NOT return any auth credentials (no access token, refresh token, or session)
 */
export async function verifyEmailWithToken(rawToken: string): Promise<VerifyEmailResult> {
  const tokenHash = await hashToken(rawToken);

  const tokenRecord = await db.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, emailVerified: true } } },
  });

  // Anti-enumeration: same message regardless of why it fails
  const genericMessage = 'Invalid or expired verification token. Please request a new one.';

  if (!tokenRecord) {
    return { success: false, message: genericMessage };
  }

  // Check if already used (one-time consumption)
  if (tokenRecord.usedAt) {
    return { success: false, message: genericMessage };
  }

  // Check if expired
  if (tokenRecord.expiresAt < new Date()) {
    return { success: false, message: genericMessage };
  }

  // Check if user's email is already verified
  if (tokenRecord.user.emailVerified) {
    // Mark token as used anyway (housekeeping)
    await db.emailVerificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });
    return { success: true, alreadyVerified: true, message: 'Email is already verified.' };
  }

  // Mark the token as used (one-time consumption)
  await db.emailVerificationToken.update({
    where: { id: tokenRecord.id },
    data: { usedAt: new Date() },
  });

  // Mark the user's email as verified
  await db.user.update({
    where: { id: tokenRecord.userId },
    data: { emailVerified: new Date() },
  });

  return { success: true, message: 'Email verified successfully.' };
}

// ─── Cleanup ───

/**
 * Delete expired verification tokens older than 7 days.
 * Called periodically for housekeeping.
 */
export async function cleanupExpiredVerificationTokens(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.emailVerificationToken.deleteMany({
    where: { expiresAt: { lt: sevenDaysAgo } },
  });
  return result.count;
}
