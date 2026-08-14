import { describe, it, expect } from 'vitest';
import { passwordField } from '@/lib/validations/common';

/**
 * Verify that all seed passwords satisfy the current password policy.
 * These are development-only passwords — NEVER use in production.
 */
describe('Seed data validity — passwords', () => {
  const DEV_PASSWORDS = [
    { email: 'admin@applecalendar.com', password: 'AdminPass2025!' },
    { email: 'organizer@events.com', password: 'OrgPass2025!' },
    { email: 'tech@events.com', password: 'OrgPass2025!' },
    { email: 'staff@events.com', password: 'StaffPass2025!' },
    { email: 'user@test.com', password: 'UserPass2025!' },
  ];

  for (const cred of DEV_PASSWORDS) {
    it(`${cred.email} password satisfies validation policy`, () => {
      const result = passwordField.safeParse(cred.password);
      expect(result.success, `Password for ${cred.email} failed validation`).toBe(true);
    });
  }

  it('all seed passwords are at least 8 characters', () => {
    for (const cred of DEV_PASSWORDS) {
      expect(cred.password.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('no seed password uses old weak passwords', () => {
    const oldWeak = ['admin123', 'org123', 'staff123', 'user123'];
    for (const cred of DEV_PASSWORDS) {
      expect(oldWeak).not.toContain(cred.password);
    }
  });
});
