// Test setup - extend expect if needed
import { expect, vi } from 'vitest';

// Set required environment variables for tests
process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-2025';
// Database URL: respect DATABASE_PROVIDER for PostgreSQL acceptance testing
if (!process.env.DATABASE_URL) {
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    process.env.DATABASE_URL = 'postgresql://applecalendar:testpass123@127.0.0.1:5432/applecalendar_test';
  } else {
    process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db';
  }
}

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/font/google
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));
