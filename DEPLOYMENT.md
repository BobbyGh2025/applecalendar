# AppleCalendar — Production Deployment Runbook

## 1. Required Environment Variables

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `DATABASE_URL` | Yes | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Yes | JWT signing secret (min 32 chars, `openssl rand -hex 32`) |
| `APP_URL` | Yes | No | Public application URL |
| `CORS_ALLOWED_ORIGINS` | Yes | No | Comma-separated allowed origins |
| `DEFAULT_CURRENCY` | No | No | Default currency code (default: GHS) |
| `PLATFORM_FEE_PERCENT` | No | No | Platform fee % (default: 5) |

## 2. PostgreSQL Setup

```bash
# Create database and user
sudo -u postgres psql <<EOF
CREATE USER applecalendar WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE applecalendar OWNER applecalendar;
GRANT ALL PRIVILEGES ON DATABASE applecalendar TO applecalendar;
EOF

# Set DATABASE_URL
export DATABASE_URL="postgresql://applecalendar:CHANGE_ME@localhost:5432/applecalendar?schema=public"
```

## 3. Prisma Migration Deployment

Production uses the dedicated PostgreSQL schema. Set:

`DATABASE_PROVIDER=postgresql`

`DATABASE_RUNTIME_MODE=external`

`DATABASE_URL=postgresql://applecalendar:CHANGE_ME@localhost:5432/applecalendar?schema=public`

Then:

```bash
bun run db:generate:postgres
bun run db:migrate:deploy
bun run db:seed
```

The production build scripts honor `DATABASE_PROVIDER=postgresql` and skip packaging the development SQLite database when `DATABASE_RUNTIME_MODE=external`.

For local development/preview, use `DATABASE_PROVIDER=sqlite` and `DATABASE_RUNTIME_MODE=sqlite`.

**IMPORTANT**: Never use `prisma db push` in production. It does not track migration history and cannot be rolled back.

## 4. Build

```bash
# Production build (standalone output)
bun run build
```

## 5. Start

```bash
# Start the production server
NODE_ENV=production \
DATABASE_URL="postgresql://..." \
JWT_SECRET="..." \
APP_URL="https://app.applecalendar.com" \
CORS_ALLOWED_ORIGINS="https://app.applecalendar.com" \
bun .next/standalone/server.js
```

## 6. Health Check

```bash
# Liveness — is the process alive?
curl -f http://localhost:3000/api/health
# Returns: {"status":"ok","timestamp":"...","service":"applecalendar"}

# Readiness — is the app ready (database connected)?
curl -f http://localhost:3000/api/ready
# Returns: {"status":"ok","checks":{"database":{"status":"ok","latencyMs":3}}}
# Returns 503 if database is unavailable
```

## 7. Rollback Considerations

- **Database migrations**: Prisma migrate does not auto-rollback. Test migrations on staging first.
- **Application**: Redeploy previous build artifact. The standalone output is self-contained.
- **Schema changes**: If a migration fails partway, the database may be in an inconsistent state. Use `prisma migrate resolve` to mark failed migrations.

## 8. Secret Rotation

- **JWT_SECRET**: Rotating invalidates ALL active sessions (access + refresh tokens). Schedule during low-traffic periods. Users must re-login.
- **DATABASE_URL**: Rotate via PostgreSQL `ALTER USER ... WITH PASSWORD`. Update env and restart.
- **Rate limit store**: In-memory only — resets on restart (no persistence to rotate).

## 9. Monitoring & Observability

- **Request IDs**: Every API response includes `X-Request-ID` header. Use this to correlate logs.
- **Structured logs**: Production logs are JSON-formatted. Key fields: `timestamp`, `level`, `message`, `service`, `context.requestId`.
- **Security headers**: All API responses include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (when behind HTTPS).
- **Rate limit headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on all rate-limited responses.

## 10. PostgreSQL Production Gate

The repository now contains a dedicated `prisma/schema.postgresql.prisma` matching the application models while preserving the SQLite schema for development.

Implemented:
- explicit PostgreSQL Prisma client generation
- PostgreSQL migration deployment
- external-database packaging mode
- runtime support for externally supplied PostgreSQL DATABASE_URL

Still required before declaring this gate closed: run migrations, seed, health/readiness checks, and the full application test suite against a real PostgreSQL instance.

## 11. Known Limitations

- **Rate limiting is in-memory**: Not effective across multiple instances. Redis backend required for horizontal scaling (Phase 5E+).
- **PostgreSQL migration untested against live server**: Migration SQL is PostgreSQL-compatible but has not been executed against a running PostgreSQL instance in this environment.
- **No CSP header**: Content Security Policy is not set (too complex for this phase without breaking Next.js/charts).
- **No file upload infrastructure**: Media URLs only (Phase 5F+).
- **No email/SMS**: Notification records exist but no delivery mechanism (Phase 5G+).
