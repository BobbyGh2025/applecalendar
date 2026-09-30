/**
 * Phase 5D: Centralized Environment Configuration
 *
 * Validates required environment variables at startup.
 * Server-only secrets are NEVER exposed to client code.
 *
 * Usage:
 *   import { env } from '@/lib/env';
 *   const secret = env.JWT_SECRET;  // Server-only
 */

// ─── Types ───

interface EnvConfig {
  // Required
  DATABASE_URL: string;
  JWT_SECRET: string;

  // Optional with defaults
  NODE_ENV: 'development' | 'production' | 'test';
  DEFAULT_CURRENCY: string;
  PLATFORM_FEE_PERCENT: number;
  APP_URL: string;
  CORS_ALLOWED_ORIGINS: string;

  // Derived
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

// ─── Validation ───

function validateEnv(): EnvConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as EnvConfig['NODE_ENV'];

  // In test mode, provide test defaults
  if (nodeEnv === 'test') {
    return {
      DATABASE_URL: process.env.DATABASE_URL || 'file:./db/test.db',
      JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret-for-vitest-2025',
      NODE_ENV: 'test',
      DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'GHS',
      PLATFORM_FEE_PERCENT: parseInt(process.env.PLATFORM_FEE_PERCENT || '5', 10),
      APP_URL: process.env.APP_URL || 'http://localhost:3000',
      CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000',
      isProduction: false,
      isDevelopment: true,
      isTest: true,
    };
  }

  // Required variables — fail clearly if missing in production
  const requiredInProduction = ['JWT_SECRET', 'DATABASE_URL'];

  if (nodeEnv === 'production') {
    for (const key of requiredInProduction) {
      if (!process.env[key]) {
        throw new Error(
          `[AppleCalendar] FATAL: ${key} environment variable is required in production. ` +
          `Set it before starting the application.`
        );
      }
    }
  }

  // In development, JWT_SECRET can fall back to a dev-only value (with warning)
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret && nodeEnv === 'development') {
    console.warn(
      '[AppleCalendar] WARNING: JWT_SECRET is not set. Using development-only secret. ' +
      'Set JWT_SECRET in .env for security.'
    );
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db',
    JWT_SECRET: jwtSecret || 'dev-only-jwt-secret-change-in-production',
    NODE_ENV: nodeEnv,
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'GHS',
    PLATFORM_FEE_PERCENT: parseInt(process.env.PLATFORM_FEE_PERCENT || '5', 10),
    APP_URL: process.env.APP_URL || 'http://localhost:3000',
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000',
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
  };
}

// ─── Lazy Singleton ───

let _env: EnvConfig | null = null;

export const env = new Proxy({} as EnvConfig, {
  get(_target, prop: string) {
    if (!_env) _env = validateEnv();
    return (_env as Record<string, unknown>)[prop];
  },
});

/**
 * Reset env cache (for testing only).
 */
export function _resetEnv() {
  _env = null;
}
