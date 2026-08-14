import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/errors';
import { AuthError } from '@/lib/auth';
import { RateLimitError } from '@/lib/rate-limit';

/**
 * Tests that verify every error path in every API route produces
 * the standardized error structure: { success: false, error: { code, message } }
 *
 * We test the error construction logic (not live HTTP) by verifying that:
 * 1. All ApiError throws use the correct error codes
 * 2. All error codes map to correct HTTP status codes
 */

describe('API error code to status code mapping', () => {
  const cases: Array<{ code: string; status: number; message: string }> = [
    // Authentication & Authorization
    { code: 'UNAUTHORIZED', status: 401, message: 'Invalid email or password' },
    { code: 'FORBIDDEN', status: 403, message: 'Insufficient permissions' },
    { code: 'AUTH_ERROR', status: 401, message: 'Authentication required' },

    // Validation
    { code: 'VALIDATION_ERROR', status: 400, message: 'Invalid input' },

    // Resource not found
    { code: 'NOT_FOUND', status: 404, message: 'Resource not found' },

    // Conflict
    { code: 'CONFLICT', status: 409, message: 'Resource already exists' },

    // Rate limiting
    { code: 'RATE_LIMITED', status: 429, message: 'Too many requests' },

    // Internal
    { code: 'INTERNAL_ERROR', status: 500, message: 'Something went wrong' },
  ];

  for (const { code, status, message } of cases) {
    it(`ApiError with code ${code} produces status ${status}`, () => {
      const err = new ApiError(status, code, message);
      expect(err.statusCode).toBe(status);
      expect(err.code).toBe(code);
      const json = err.toJSON();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe(code);
      expect(json.error.message).toBe(message);
    });
  }
});

describe('AuthError codes via handleApiError', () => {
  const { mockJson } = vi.hoisted(() => ({ mockJson: vi.fn() }));

  vi.mock('next/server', () => ({
    NextResponse: { json: mockJson },
  }));

  vi.mock('@/lib/auth', () => ({
    AuthError: class AuthError extends Error {
      statusCode: number;
      constructor(message: string, statusCode: number = 401) {
        super(message);
        this.statusCode = statusCode;
      }
    },
  }));

  vi.mock('@/lib/db', () => ({ db: {} }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockJson.mockReturnValue({ status: 500 });
  });

  it('AuthError(message, 401) maps to AUTH_ERROR', async () => {
    const { handleApiError } = await import('@/lib/errors');
    mockJson.mockReturnValue({ status: 401 });
    handleApiError(new AuthError('Authentication required'));
    const body = mockJson.mock.calls[0][0] as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_ERROR');
  });

  it('AuthError(message, 403) maps to AUTH_ERROR with status 403', async () => {
    const { handleApiError } = await import('@/lib/errors');
    mockJson.mockReturnValue({ status: 403 });
    handleApiError(new AuthError('Insufficient permissions', 403));
    const status = (mockJson.mock.calls[0][1] as { status: number }).status;
    expect(status).toBe(403);
  });
});

describe('All API route files use standardized error responses', () => {
  it('no route file contains old-format { error: ... } responses', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const apiDir = path.join(process.cwd(), 'src/app/api');

    function walkDir(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkDir(full));
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
      return files;
    }

    const routeFiles = walkDir(apiDir);
    const violations: string[] = [];

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Check for old-format: NextResponse.json({ error: '...' })
      const oldFormatPattern = /NextResponse\.json\(\s*\{\s*error:\s*['"\`]/;
      if (oldFormatPattern.test(content)) {
        violations.push(file);
      }
      // Check for old manual AuthError handling
      if (content.includes('instanceof AuthError')) {
        violations.push(`${file} (manual AuthError handling)`);
      }
      // Check for console.error in API routes
      if (/console\.error/.test(content)) {
        violations.push(`${file} (console.error leak)`);
      }
    }

    expect(violations, `Files with non-standard error format:\n${violations.join('\n')}`).toEqual([]);
  });
});
