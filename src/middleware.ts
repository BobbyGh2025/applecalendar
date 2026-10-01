import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware — Security, CORS, Request ID
 *
 * Request body size limit:
 *   Next.js enforces a 1MB body size limit by default on API routes.
 *   This protects against oversized payloads without explicit middleware.
 *   To increase, set `experimental.serverActions.bodySizeLimit` in next.config.ts
 *   or handle per-route with custom request parsing.
 *   See: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
 */

// ─── Allowed Origins ───

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  }
  // Default: development only
  return ['http://localhost:3000'];
}

function isOriginAllowed(origin: string): boolean {
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

// ─── Request ID ───

function getOrCreateRequestId(request: NextRequest): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming && /^[a-zA-Z0-9\-\.]{1,64}$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

// ─── Security Headers ───

function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  // HSTS only when behind HTTPS proxy (indicated by X-Forwarded-Proto)
  // This is set at the response level after we check the request
  return headers;
}

// ─── Middleware ───

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only process API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 1. Request ID
  const requestId = getOrCreateRequestId(request);

  // 2. CORS — check Origin header
  const origin = request.headers.get('origin');
  const isAllowedOrigin = origin ? isOriginAllowed(origin) : false;

  // 3. Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });

    if (origin && isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Remaining, X-RateLimit-Reset');
    response.headers.set('Access-Control-Max-Age', '86400');
    response.headers.set('X-Request-ID', requestId);

    // Security headers on OPTIONS too
    const secHeaders = getSecurityHeaders();
    for (const [key, value] of Object.entries(secHeaders)) {
      response.headers.set(key, value);
    }

    return response;
  }

  // 4. Process the request
  const response = NextResponse.next();

  // Set request ID on response
  response.headers.set('X-Request-ID', requestId);

  // CORS headers for allowed origins
  if (origin && isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Remaining, X-RateLimit-Reset');
  }

  // Security headers
  const secHeaders = getSecurityHeaders();
  for (const [key, value] of Object.entries(secHeaders)) {
    response.headers.set(key, value);
  }

  // HSTS — only set if the request came through HTTPS (behind a proxy)
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto === 'https') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
