// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  refreshTokenSchema,
  updateProfileSchema,
  updateOrganizerProfileSchema,
  inviteStaffSchema,
  updateMemberSchema,
  acceptInvitationSchema,
} from '@/lib/validations/identity';
import {
  PERMISSIONS,
  OWNER_PERMISSIONS,
  MANAGER_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  hasPermission,
  getOrganizerPermissions,
} from '@/lib/permissions';
import { generateSecureToken, hashToken, verifyTokenHash } from '@/lib/tokens';
import {
  generateToken,
  verifyToken,
  generateRefreshToken,
  verifyRefreshToken,
  requireOrganizerOrAdmin,
  AuthError,
} from '@/lib/auth';

// ─── Test: Identity Validation Schemas ───

describe('Phase 2 — Identity Validation Schemas', () => {
  describe('forgotPasswordSchema', () => {
    it('accepts valid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
    });
    it('rejects invalid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    });
    it('rejects missing email', () => {
      expect(forgotPasswordSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid token and password', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc-123', newPassword: 'newPass123' }).success).toBe(true);
    });
    it('rejects short password', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: 'short' }).success).toBe(false);
    });
    it('rejects missing token', () => {
      expect(resetPasswordSchema.safeParse({ newPassword: 'newPass123' }).success).toBe(false);
    });
  });

  describe('changePasswordSchema', () => {
    it('accepts valid current and new password', () => {
      expect(changePasswordSchema.safeParse({ currentPassword: 'old12345', newPassword: 'new12345' }).success).toBe(true);
    });
    it('rejects short new password', () => {
      expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success).toBe(false);
    });
    it('rejects missing current password', () => {
      expect(changePasswordSchema.safeParse({ newPassword: 'new12345' }).success).toBe(false);
    });
  });

  describe('verifyEmailSchema', () => {
    it('accepts valid token', () => {
      expect(verifyEmailSchema.safeParse({ token: 'verify-token-123' }).success).toBe(true);
    });
    it('rejects empty token', () => {
      expect(verifyEmailSchema.safeParse({ token: '' }).success).toBe(false);
    });
  });

  describe('refreshTokenSchema', () => {
    it('accepts valid refresh token', () => {
      expect(refreshTokenSchema.safeParse({ refreshToken: 'rt-123' }).success).toBe(true);
    });
    it('rejects empty refresh token', () => {
      expect(refreshTokenSchema.safeParse({ refreshToken: '' }).success).toBe(false);
    });
  });

  describe('updateProfileSchema', () => {
    it('accepts valid name update', () => {
      expect(updateProfileSchema.safeParse({ name: 'John Doe' }).success).toBe(true);
    });
    it('accepts valid bio update', () => {
      expect(updateProfileSchema.safeParse({ bio: 'Hello world' }).success).toBe(true);
    });
    it('accepts all fields', () => {
      expect(updateProfileSchema.safeParse({
        name: 'John Doe',
        avatar: 'https://example.com/avatar.jpg',
        bio: 'A bio',
        phone: '+1-555-0000',
      }).success).toBe(true);
    });
    it('rejects name over 100 chars', () => {
      expect(updateProfileSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
    });
  });

  describe('updateOrganizerProfileSchema', () => {
    it('accepts valid organization name', () => {
      expect(updateOrganizerProfileSchema.safeParse({ organizationName: 'My Org' }).success).toBe(true);
    });
    it('accepts social links', () => {
      expect(updateOrganizerProfileSchema.safeParse({
        socialLinks: { twitter: '@handle', linkedin: 'company/name' },
      }).success).toBe(true);
    });
    it('rejects invalid website URL', () => {
      expect(updateOrganizerProfileSchema.safeParse({ website: 'not-a-url' }).success).toBe(false);
    });
  });

  describe('inviteStaffSchema', () => {
    it('accepts valid email and default role', () => {
      const result = inviteStaffSchema.safeParse({ email: 'staff@example.com' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('STAFF');
        expect(result.data.permissions).toEqual([]);
      }
    });
    it('accepts MANAGER role', () => {
      expect(inviteStaffSchema.safeParse({ email: 'staff@example.com', role: 'MANAGER' }).success).toBe(true);
    });
    it('rejects invalid role', () => {
      expect(inviteStaffSchema.safeParse({ email: 'staff@example.com', role: 'OWNER' }).success).toBe(false);
    });
  });

  describe('updateMemberSchema', () => {
    it('accepts role update', () => {
      expect(updateMemberSchema.safeParse({ role: 'MANAGER' }).success).toBe(true);
    });
    it('accepts status update', () => {
      expect(updateMemberSchema.safeParse({ status: 'SUSPENDED' }).success).toBe(true);
    });
    it('rejects invalid status', () => {
      expect(updateMemberSchema.safeParse({ status: 'REMOVED' }).success).toBe(false);
    });
  });

  describe('acceptInvitationSchema', () => {
    it('accepts valid token', () => {
      expect(acceptInvitationSchema.safeParse({ token: 'invite-123' }).success).toBe(true);
    });
    it('rejects empty token', () => {
      expect(acceptInvitationSchema.safeParse({ token: '' }).success).toBe(false);
    });
  });
});

// ─── Test: Permission System ───

describe('Phase 2 — Permission System', () => {
  describe('hasPermission', () => {
    it('returns true when permission is in list', () => {
      expect(hasPermission(['events.view', 'events.create'], 'events.view')).toBe(true);
    });
    it('returns false when permission is not in list', () => {
      expect(hasPermission(['events.view'], 'events.create')).toBe(false);
    });
    it('returns false for empty permissions', () => {
      expect(hasPermission([], 'events.view')).toBe(false);
    });
  });

  describe('OWNER_PERMISSIONS', () => {
    it('includes all permissions', () => {
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.EVENTS_VIEW);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.EVENTS_CREATE);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.EVENTS_UPDATE);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.EVENTS_DELETE);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.EVENTS_PUBLISH);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.STAFF_MANAGE);
      expect(OWNER_PERMISSIONS).toContain(PERMISSIONS.ORGANIZER_UPDATE);
    });
  });

  describe('DEFAULT_STAFF_PERMISSIONS', () => {
    it('does not include staff.manage', () => {
      expect(DEFAULT_STAFF_PERMISSIONS).not.toContain(PERMISSIONS.STAFF_MANAGE);
    });
    it('does not include events.create', () => {
      expect(DEFAULT_STAFF_PERMISSIONS).not.toContain(PERMISSIONS.EVENTS_CREATE);
    });
    it('includes events.view', () => {
      expect(DEFAULT_STAFF_PERMISSIONS).toContain(PERMISSIONS.EVENTS_VIEW);
    });
  });

  describe('getOrganizerPermissions', () => {
    it('returns OWNER_PERMISSIONS for OWNER role', () => {
      const perms = getOrganizerPermissions({ role: 'OWNER', permissions: '[]' });
      expect(perms).toEqual(OWNER_PERMISSIONS);
    });

    it('returns MANAGER_PERMISSIONS for MANAGER role', () => {
      const perms = getOrganizerPermissions({ role: 'MANAGER', permissions: '[]' });
      expect(perms).toEqual(MANAGER_PERMISSIONS);
    });

    it('returns DEFAULT_STAFF_PERMISSIONS for STAFF role', () => {
      const perms = getOrganizerPermissions({ role: 'STAFF', permissions: '[]' });
      expect(perms).toEqual(DEFAULT_STAFF_PERMISSIONS);
    });

    it('uses custom permissions when provided', () => {
      const customPerms = ['events.view', 'events.create'];
      const perms = getOrganizerPermissions({ role: 'STAFF', permissions: JSON.stringify(customPerms) });
      expect(perms).toEqual(customPerms);
    });

    it('falls back to role defaults for empty custom permissions', () => {
      const perms = getOrganizerPermissions({ role: 'OWNER', permissions: '[]' });
      expect(perms).toEqual(OWNER_PERMISSIONS);
    });

    it('handles invalid JSON gracefully', () => {
      const perms = getOrganizerPermissions({ role: 'STAFF', permissions: 'invalid-json' });
      expect(perms).toEqual(DEFAULT_STAFF_PERMISSIONS);
    });
  });
});

// ─── Test: Token Utility ───

describe('Phase 2 — Token Utility', () => {
  describe('generateSecureToken', () => {
    it('generates a non-empty string', () => {
      const token = generateSecureToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateSecureToken()));
      expect(tokens.size).toBe(100);
    });
  });

  describe('hashToken', () => {
    it('generates a consistent hash', async () => {
      const hash1 = await hashToken('test-token');
      const hash2 = await hashToken('test-token');
      expect(hash1).toBe(hash2);
    });

    it('generates different hashes for different tokens', async () => {
      const hash1 = await hashToken('token-1');
      const hash2 = await hashToken('token-2');
      expect(hash1).not.toBe(hash2);
    });

    it('generates a hex string', async () => {
      const hash = await hashToken('test-token');
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('verifyTokenHash', () => {
    it('returns true for matching token and hash', async () => {
      const token = 'my-secure-token';
      const hash = await hashToken(token);
      const result = await verifyTokenHash(token, hash);
      expect(result).toBe(true);
    });

    it('returns false for non-matching token', async () => {
      const hash = await hashToken('correct-token');
      const result = await verifyTokenHash('wrong-token', hash);
      expect(result).toBe(false);
    });
  });
});

// ─── Test: Auth Module (Lazy JWT Secret) ───

describe('Phase 2 — Auth Module', () => {
  it('lazy JWT secret — functions exist without throwing at module level', () => {
    expect(generateToken).toBeDefined();
    expect(verifyToken).toBeDefined();
    expect(generateRefreshToken).toBeDefined();
    expect(verifyRefreshToken).toBeDefined();
    expect(requireOrganizerOrAdmin).toBeDefined();
    expect(AuthError).toBeDefined();
  });

  it('AuthError has correct statusCode', () => {
    const err = new AuthError('test', 403);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('test');
  });

  it('requireOrganizerOrAdmin throws for PUBLIC role', () => {
    expect(() => requireOrganizerOrAdmin({ role: 'PUBLIC' })).toThrow(AuthError);
  });

  it('requireOrganizerOrAdmin passes for ORGANIZER role', () => {
    const result = requireOrganizerOrAdmin({ role: 'ORGANIZER' });
    expect(result.role).toBe('ORGANIZER');
  });

  it('requireOrganizerOrAdmin passes for SUPER_ADMIN role', () => {
    const result = requireOrganizerOrAdmin({ role: 'SUPER_ADMIN' });
    expect(result.role).toBe('SUPER_ADMIN');
  });

  it('generates and verifies access token', async () => {
    const token = await generateToken({ userId: 'test-id', email: 'test@example.com', role: 'PUBLIC' });
    expect(typeof token).toBe('string');
    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('test-id');
    expect(payload?.role).toBe('PUBLIC');
  });

  it('generates and verifies refresh token', async () => {
    const token = await generateRefreshToken({ userId: 'test-id', email: 'test@example.com', role: 'PUBLIC' });
    expect(typeof token).toBe('string');
    const payload = await verifyRefreshToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('test-id');
    expect(payload?.type).toBe('refresh');
  });

  it('access token cannot be used as refresh token', async () => {
    const token = await generateToken({ userId: 'test-id', email: 'test@example.com', role: 'PUBLIC' });
    const payload = await verifyRefreshToken(token);
    expect(payload).toBeNull();
  });

  it('refresh token cannot be used as access token', async () => {
    const token = await generateRefreshToken({ userId: 'test-id', email: 'test@example.com', role: 'PUBLIC' });
    const payload = await verifyToken(token);
    expect(payload).toBeNull();
  });
});
