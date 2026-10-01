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

  // Phase 5E: Payment domain
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_PUBLIC_KEY: string;
  PAYSTACK_BASE_URL: string;
  PAYSTACK_WEBHOOK_SECRET: string;
  PAYMENT_EXPIRY_MINUTES: number;

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
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || 'sk_test_default',
      PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_default',
      PAYSTACK_BASE_URL: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
      PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET || 'test-webhook-secret',
      PAYMENT_EXPIRY_MINUTES: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || '15', 10),
      isProduction: false,
      isDevelopment: true,
      isTest: true,
    };
  }

  // Required variables — fail clearly if missing in production
  const requiredInProduction = ['JWT_SECRET', 'DATABASE_URL', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY', 'PAYSTACK_WEBHOOK_SECRET'];

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

  // Phase 5E: Paystack configuration
  const paystackBaseUrl = nodeEnv === 'production'
    ? (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co')
    : (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co'); // Same URL, test/live determined by key prefix

  return {
    DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db',
    JWT_SECRET: jwtSecret || 'dev-only-jwt-secret-change-in-production',
    NODE_ENV: nodeEnv,
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'GHS',
    PLATFORM_FEE_PERCENT: parseInt(process.env.PLATFORM_FEE_PERCENT || '5', 10),
    APP_URL: process.env.APP_URL || 'http://localhost:3000',
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000',
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || 'sk_test_dev_placeholder',
    PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_dev_placeholder',
    PAYSTACK_BASE_URL: paystackBaseUrl,
    PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET || 'dev-webhook-secret-placeholder',
    PAYMENT_EXPIRY_MINUTES: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || '15', 10),
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
