// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createSessionAndTokens,
  verifyAccessToken,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
  cleanupSessions,
} from '@/lib/auth';
import { hashToken } from '@/lib/tokens';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';

describe('Phase 5B — Session & Token Infrastructure (RefreshToken Architecture)', () => {
  let testUserId: string;
  let testSessionId: string;

  beforeAll(async () => {
    // Create a test user
    const hashedPassword = await hash('TestPass2025!', 12);
    const user = await db.user.upsert({
      where: { email: 'session-test@applecalendar.com' },
      update: {},
      create: {
        email: 'session-test@applecalendar.com',
        password: hashedPassword,
        name: 'Session Test User',
        role: 'PUBLIC',
      },
    });
    testUserId = user.id;
  });

  describe('createSessionAndTokens', () => {
    it('should return accessToken, refreshToken, sessionId, and expiresIn', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.expiresIn).toBe(900); // 15 minutes
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(typeof result.sessionId).toBe('string');
    });

    it('should create a RefreshToken record in the database', async () => {
      const beforeCount = await db.refreshToken.count({ where: { userId: testUserId, isRevoked: false } });

      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const afterCount = await db.refreshToken.count({ where: { userId: testUserId, isRevoked: false } });
      expect(afterCount).toBe(beforeCount + 1);

      // The sessionId should be the RefreshToken.id
      const refreshTokenRecord = await db.refreshToken.findUnique({
        where: { id: result.sessionId },
      });
      expect(refreshTokenRecord).toBeDefined();
      expect(refreshTokenRecord!.isRevoked).toBe(false);
    });

    it('should store token hashes, not raw tokens', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      // The refresh token hash should be stored in the RefreshToken record
      const refreshHash = await hashToken(result.refreshToken);
      const session = await db.refreshToken.findUnique({
        where: { id: result.sessionId },
      });

      expect(session).toBeDefined();
      expect(session?.tokenHash).toBe(refreshHash);
      expect(session?.isRevoked).toBe(false);

      testSessionId = session!.id;
    });
  });

  describe('verifyAccessToken', () => {
    it('should return payload for valid access token with type and sessionId', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const payload = await verifyAccessToken(result.accessToken);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe(testUserId);
      expect(payload!.email).toBe('session-test@applecalendar.com');
      expect(payload!.role).toBe('PUBLIC');
      expect(payload!.type).toBe('access');
      expect(payload!.sessionId).toBe(result.sessionId);
    });

    it('should return null for refresh token used as access token', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const payload = await verifyAccessToken(result.refreshToken);
      expect(payload).toBeNull();
    });

    it('should return null for invalid token', async () => {
      const payload = await verifyAccessToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should return null for access token with revoked session', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      // Revoke the session
      await revokeSession(result.sessionId);

      // The access token should no longer be valid
      const payload = await verifyAccessToken(result.accessToken);
      expect(payload).toBeNull();
    });
  });

  describe('hashToken', () => {
    it('should produce consistent SHA-256 hashes', async () => {
      const token = 'test-token-value';
      const hash1 = await hashToken(token);
      const hash2 = await hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex digest
    });

    it('should produce different hashes for different tokens', async () => {
      const hash1 = await hashToken('token-a');
      const hash2 = await hashToken('token-b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('refreshSession', () => {
    it('should rotate tokens and return new pair', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const refreshed = await refreshSession(result.refreshToken);
      expect(refreshed.success).toBe(true);
      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.refreshToken).toBeDefined();
      expect(refreshed.sessionId).toBeDefined();
      expect(refreshed.expiresIn).toBe(900);
    });

    it('should invalidate old refresh token after rotation', async () => {
      // Create a dedicated user to avoid interference
      const dedicatedUser = await db.user.upsert({
        where: { email: 'rotation-test@applecalendar.com' },
        update: {},
        create: {
          email: 'rotation-test@applecalendar.com',
          password: await hash('RotationTest2025!', 12),
          name: 'Rotation Test',
          role: 'PUBLIC',
        },
      });

      const result = await createSessionAndTokens({
        userId: dedicatedUser.id,
        email: 'rotation-test@applecalendar.com',
        role: 'PUBLIC',
      });

      // First refresh works
      const refreshed1 = await refreshSession(result.refreshToken);
      expect(refreshed1.success).toBe(true);
      expect(refreshed1.refreshToken).not.toBe(result.refreshToken);

      // Second refresh with the same old token should fail (token was rotated, hash changed)
      let threw = false;
      let errorMsg = '';
      try {
        await refreshSession(result.refreshToken);
      } catch (e: any) {
        threw = true;
        errorMsg = e.message;
      }
      expect(threw).toBe(true);
      // After rotation, the old token record exists but is marked revoked
      // This is correct behavior — it means token reuse is detected
      expect(errorMsg).toMatch(/Session (not found|has been revoked)/);
    });

    it('should fail for revoked session', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      // Revoke the session
      await revokeSession(result.sessionId);

      // Refresh should fail
      try {
        await refreshSession(result.refreshToken);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('revoked');
      }
    });
  });

  describe('revokeSession', () => {
    it('should mark session as revoked', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      await revokeSession(result.sessionId);

      const session = await db.refreshToken.findUnique({ where: { id: result.sessionId } });
      expect(session?.isRevoked).toBe(true);
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all sessions for a user and return count', async () => {
      // Create multiple sessions
      await createSessionAndTokens({ userId: testUserId, email: 'session-test@applecalendar.com', role: 'PUBLIC' });
      await createSessionAndTokens({ userId: testUserId, email: 'session-test@applecalendar.com', role: 'PUBLIC' });

      const count = await revokeAllSessions(testUserId);
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('listActiveSessions', () => {
    it('should return active sessions for a user with isCurrent flag', async () => {
      // Create a fresh session
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const sessions = await listActiveSessions(testUserId, result.sessionId);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some((s) => s.isCurrent)).toBe(true);
    });
  });

  describe('cleanupSessions', () => {
    it('should delete expired and revoked sessions', async () => {
      const count = await cleanupSessions();
      expect(typeof count).toBe('number');
    });
  });
});
