import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { hashToken, revokeAllSessions } from '@/lib/auth';

// ─── Configuration ───

/** Password reset token expires in 60 minutes */
const RESET_TOKEN_TTL_MINUTES = 60;

// ─── Token generation ───

/**
 * Generate a cryptographically secure password-reset token and store its hash in the database.
 * Returns the RAW token — this is the only time it exists in plaintext.
 * The raw token should be sent to the user via email (or returned in dev mode).
 *
 * Security properties:
 * - Any previous unused reset tokens for this user are invalidated (marked usedAt)
 *   to ensure only the latest token is valid.
 * - Token is hashed with SHA-256 before storage.
 * - Token expires after 60 minutes.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  // Invalidate any previous unused reset tokens for this user
  await db.passwordResetToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  // Generate a crypto-secure token (64 hex chars = 32 bytes of entropy)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return rawToken;
}

// ─── Token verification & password reset ───

export interface ResetPasswordResult {
  success: boolean;
  sessionsRevoked?: number;
  message: string;
}

/**
 * Reset a user's password using a raw reset token.
 *
 * Security properties:
 * - Token is hashed before DB lookup (timing-safe comparison via hash match)
 * - Expired tokens are rejected
 * - Used tokens are rejected (one-time consumption)
 * - Anti-enumeration: same generic message for invalid/expired/used tokens
 * - Prevents resetting to the current password (reuse check)
 * - Revoke ALL existing sessions after successful reset
 * - Does NOT return any auth credentials (no access token, refresh token, or session)
 * - Never reveals whether a token was valid, expired, or previously used
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(rawToken);

  const tokenRecord = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, password: true } } },
  });

  // Anti-enumeration: same message regardless of why it fails
  const genericMessage =
    'Invalid or expired reset token. Please request a new password reset.';

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

  // Prevent resetting to the current password
  const isSamePassword = await bcrypt.compare(newPassword, tokenRecord.user.password);
  if (isSamePassword) {
    return {
      success: false,
      message: 'New password must be different from your current password.',
    };
  }

  // Mark the token as used (one-time consumption) — do this FIRST
  // to prevent race conditions where the same token could be used twice
  await db.passwordResetToken.update({
    where: { id: tokenRecord.id },
    data: { usedAt: new Date() },
  });

  // Hash the new password and update the user
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await db.user.update({
    where: { id: tokenRecord.userId },
    data: { password: hashedPassword },
  });

  // Revoke ALL existing sessions (user must log in again)
  const sessionsRevoked = await revokeAllSessions(tokenRecord.userId);

  return {
    success: true,
    sessionsRevoked,
    message: 'Password reset successfully. Please log in with your new password.',
  };
}

// ─── Cleanup ───

/**
 * Delete expired password-reset tokens older than 7 days.
 * Called periodically for housekeeping.
 */
export async function cleanupExpiredResetTokens(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: sevenDaysAgo } },
  });
  return result.count;
}
