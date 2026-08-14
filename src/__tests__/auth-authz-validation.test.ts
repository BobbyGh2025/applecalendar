import { describe, it, expect } from 'vitest';
import { authSchema } from '@/lib/validations';
import { passwordField, emailField, userRoleField } from '@/lib/validations/common';

// ---- Authentication failures ----

describe('Authentication — password validation failures', () => {
  const tooShort = ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg']; // 1-7 chars

  for (const pw of tooShort) {
    it(`rejects ${pw.length}-char password: "${pw}"`, () => {
      const result = passwordField.safeParse(pw);
      expect(result.success).toBe(false);
    });
  }

  it('rejects non-string password', () => {
    expect(passwordField.safeParse(12345678).success).toBe(false);
    expect(passwordField.safeParse(null).success).toBe(false);
    expect(passwordField.safeParse(undefined).success).toBe(false);
  });
});

describe('Authentication — email validation failures', () => {
  const invalid = ['not-an-email', '@no-user.com', 'no-at.com', 'spaces in@email.com', ''];

  for (const email of invalid) {
    it(`rejects email: "${email}"`, () => {
      const result = emailField.safeParse(email);
      expect(result.success).toBe(false);
    });
  }
});

// ---- Authorization failures ----

describe('Authorization — role validation', () => {
  it('accepts all valid roles', () => {
    for (const role of ['PUBLIC', 'ORGANIZER', 'STAFF', 'SUPER_ADMIN']) {
      expect(userRoleField.safeParse(role).success).toBe(true);
    }
  });

  it('rejects invalid roles', () => {
    const invalid = ['ADMIN', 'USER', 'MANAGER', 'GOD', 'public', 'organizer', ''];
    for (const role of invalid) {
      expect(userRoleField.safeParse(role).success, `Should reject role: ${role}`).toBe(false);
    }
  });
});

// ---- Validation failures (full auth schema) ----

describe('Auth schema — validation failures', () => {
  it('missing action fails', () => {
    const result = authSchema.safeParse({ email: 'test@test.com', password: 'password123' });
    expect(result.success).toBe(false);
  });

  it('empty body fails', () => {
    const result = authSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('register without name fails', () => {
    const result = authSchema.safeParse({
      action: 'register',
      email: 'test@test.com',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('register with empty name fails', () => {
    const result = authSchema.safeParse({
      action: 'register',
      email: 'test@test.com',
      password: 'password123',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('login with short password fails', () => {
    const result = authSchema.safeParse({
      action: 'login',
      email: 'test@test.com',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });
});
