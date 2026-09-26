# Phase 4C — Organizer Lifecycle Management Backend

**Task ID:** 2
**Agent:** main
**Status:** COMPLETE

## Files Created (8 files)

### 1. `src/lib/services/organizer-lifecycle.ts` — Centralized lifecycle service

- **OrganizerLifecycleStatus** type: `'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DEACTIVATED'`
- **LifecycleAction** type: `'ORGANIZER_APPROVED' | 'ORGANIZER_REJECTED' | 'ORGANIZER_SUSPENDED' | 'ORGANIZER_REINSTATED' | 'ORGANIZER_DEACTIVATED'`
- **Exported action constants**: `ORGANIZER_APPROVED`, `ORGANIZER_REJECTED`, `ORGANIZER_SUSPENDED`, `ORGANIZER_REINSTATED`, `ORGANIZER_DEACTIVATED`

**State transition map (legal transitions):**
| Current Status | Action | New Status |
|---|---|---|
| PENDING_APPROVAL | ORGANIZER_APPROVED | ACTIVE |
| PENDING_APPROVAL | ORGANIZER_REJECTED | REJECTED |
| APPROVED | ORGANIZER_APPROVED | ACTIVE |
| APPROVED | ORGANIZER_REJECTED | REJECTED |
| APPROVED | ORGANIZER_SUSPENDED | SUSPENDED |
| APPROVED | ORGANIZER_DEACTIVATED | DEACTIVATED |
| ACTIVE | ORGANIZER_SUSPENDED | SUSPENDED |
| ACTIVE | ORGANIZER_DEACTIVATED | DEACTIVATED |
| SUSPENDED | ORGANIZER_REINSTATED | ACTIVE |
| SUSPENDED | ORGANIZER_DEACTIVATED | DEACTIVATED |
| REJECTED | ORGANIZER_DEACTIVATED | DEACTIVATED |
| DEACTIVATED | *(none)* | *(terminal state)* |

**Exported functions:**
- `validateTransition(currentStatus, action)` — validates transition legality, throws `ApiError(409, 'INVALID_STATUS_TRANSITION')` if illegal
- `executeLifecycleTransition(params)` — full atomic lifecycle transition:
  1. Loads organizer profile from DB
  2. Validates transition via `validateTransition`
  3. Requires reason for REJECTED/SUSPENDED/DEACTIVATED (throws `REASON_REQUIRED`)
  4. Prisma `$transaction`: updates OrganizerProfile + creates AuditLog
  5. Creates Notification for organizer user
  6. Returns `{ profile, auditLog }`

**Backward compat:**
- Approve/reinstate → `approvalStatus = 'APPROVED'`
- Reject → `approvalStatus = 'REJECTED'`

### 2. `src/app/api/admin/organizers/route.ts` — GET list organizers

- SUPER_ADMIN only
- Query params: `status`, `search`, `page`, `limit`
- Returns organizers with user info, subscription summary, membership/invitation counts
- Pagination support

### 3. `src/app/api/admin/organizers/[id]/route.ts` — GET organizer detail

- SUPER_ADMIN only
- Returns profile, owner info (no passwords/tokens), subscription, membership count, event count, recent audit logs

### 4. `src/app/api/admin/organizers/[id]/approve/route.ts` — PATCH approve

- SUPER_ADMIN only
- Calls `executeLifecycleTransition` with `ORGANIZER_APPROVED`

### 5. `src/app/api/admin/organizers/[id]/reject/route.ts` — PATCH reject

- SUPER_ADMIN only
- Body: `{ reason: string }` (required)
- Calls `executeLifecycleTransition` with `ORGANIZER_REJECTED`

### 6. `src/app/api/admin/organizers/[id]/suspend/route.ts` — PATCH suspend

- SUPER_ADMIN only
- Body: `{ reason: string }` (required)
- Calls `executeLifecycleTransition` with `ORGANIZER_SUSPENDED`

### 7. `src/app/api/admin/organizers/[id]/reinstate/route.ts` — PATCH reinstate

- SUPER_ADMIN only
- Calls `executeLifecycleTransition` with `ORGANIZER_REINSTATED`

### 8. `src/app/api/admin/organizers/[id]/deactivate/route.ts` — PATCH deactivate

- SUPER_ADMIN only
- Body: `{ reason: string }` (required)
- Calls `executeLifecycleTransition` with `ORGANIZER_DEACTIVATED`

## Patterns Followed

- All routes use `NextRequest`/`NextResponse` from `next/server`
- Authentication via `authenticate()` + `requireRole('SUPER_ADMIN')()`
- Route params use `{ params }: { params: Promise<{ id: string }> }` with `await params`
- All routes wrap in try/catch returning `handleApiError(error)`
- All responses use `{ success: true, ... }` format
- Database access via `db` from `@/lib/db`
- Errors via `ApiError` from `@/lib/errors`

## Verification

- **ESLint**: Only pre-existing errors in `server-keeper.js` — zero new errors
- **TypeScript**: Zero new errors (pre-existing `verify/route.ts` errors left alone as instructed)
- **Dev server**: Running normally (HTTP 200 on /)
