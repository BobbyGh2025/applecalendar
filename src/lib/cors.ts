/**
 * Phase 5D: CORS Utilities
 *
 * The primary CORS handling is in src/middleware.ts.
 * This module provides utilities for API routes that need
 * additional CORS validation or dynamic origin handling.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Get the allowed origins from environment configuration.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  }
  return ['http://localhost:3000'];
}

/**
 * Check if an origin is allowed.
 */
export function isOriginAllowed(origin: string): boolean {
  return getAllowedOrigins().includes(origin);
}

/**
 * Create a 204 No Content response for OPTIONS preflight requests.
 * Used when middleware is bypassed (shouldn't happen, but defensive).
 */
export function handlePreflight(request: NextRequest): NextResponse | null {
  if (request.method !== 'OPTIONS') return null;

  const origin = request.headers.get('origin');
  const response = new NextResponse(null, { status: 204 });

  if (origin && isOriginAllowed(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  response.headers.set('Access-Control-Max-Age', '86400');

  return response;
}
