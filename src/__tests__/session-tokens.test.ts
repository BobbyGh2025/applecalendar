// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { createSessionAndTokens, verifyAccessToken, hashToken, refreshSession, revokeSession, revokeAllSessions, listActiveSessions, cleanupSessions } from '@/lib/auth';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';

describe('Phase 2A — Session & Token Infrastructure', () => {
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
    it('should return accessToken, refreshToken, and expiresIn', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900); // 15 minutes
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should create a UserSession record in the database', async () => {
      const beforeCount = await db.userSession.count({ where: { userId: testUserId } });

      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const afterCount = await db.userSession.count({ where: { userId: testUserId } });
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should store token hashes, not raw tokens', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const accessHash = hashToken(result.accessToken);
      const refreshHash = hashToken(result.refreshToken);

      const session = await db.userSession.findFirst({
        where: { accessTokenHash: accessHash },
      });

      expect(session).toBeDefined();
      expect(session?.refreshTokenHash).toBe(refreshHash);
      expect(session?.isRevoked).toBe(false);

      testSessionId = session!.id;
    });
  });

  describe('verifyAccessToken', () => {
    it('should return payload for valid access token', async () => {
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
      expect(payload!.sessionId).toBeDefined();
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
  });

  describe('hashToken', () => {
    it('should produce consistent SHA-256 hashes', () => {
      const token = 'test-token-value';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex digest
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = hashToken('token-a');
      const hash2 = hashToken('token-b');
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
      expect(errorMsg).toContain('Session not found');
    });

    it('should fail for revoked session', async () => {
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });

      const payload = await verifyAccessToken(result.accessToken);
      const sessionId = payload!.sessionId;

      // Revoke the session
      await revokeSession(sessionId);

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

      const payload = await verifyAccessToken(result.accessToken);
      const sessionId = payload!.sessionId;

      await revokeSession(sessionId);

      const session = await db.userSession.findUnique({ where: { id: sessionId } });
      expect(session?.isRevoked).toBe(true);
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all sessions for a user', async () => {
      // Create multiple sessions
      await createSessionAndTokens({ userId: testUserId, email: 'session-test@applecalendar.com', role: 'PUBLIC' });
      await createSessionAndTokens({ userId: testUserId, email: 'session-test@applecalendar.com', role: 'PUBLIC' });

      const count = await revokeAllSessions(testUserId);
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('listActiveSessions', () => {
    it('should return active sessions for a user', async () => {
      // Create a fresh session
      const result = await createSessionAndTokens({
        userId: testUserId,
        email: 'session-test@applecalendar.com',
        role: 'PUBLIC',
      });
      const payload = await verifyAccessToken(result.accessToken);

      const sessions = await listActiveSessions(testUserId, payload?.sessionId);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some((s) => s.isCurrent)).toBe(true);
    });
  });

  describe('cleanupSessions', () => {
    it('should delete expired sessions', async () => {
      const count = await cleanupSessions();
      expect(typeof count).toBe('number');
    });
  });
});
