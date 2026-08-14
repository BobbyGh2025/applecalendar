# AppleCalendar — Complete Technical Audit Report

Generated: 2025
Auditor: Automated codebase inspection

---

## 1. Current Technology Stack

| Layer | Technology | Status | Notes |
|-------|-----------|--------|-------|
| **Framework** | Next.js 16.1.1 (App Router, Turbopack) | ✅ Active | Output: standalone |
| **Language** | TypeScript 5 | ✅ Active | `noImplicitAny: false` — loose typing |
| **Runtime** | Bun | ✅ Active | Scripts use `bun run` |
| **Frontend Library** | React 19 | ✅ Active | |
| **Styling** | Tailwind CSS 4 + tw-animate-css | ✅ Active | oklch color tokens, light/dark CSS vars |
| **UI Components** | shadcn/ui (New York style) | ✅ Active | 35+ Radix UI primitives |
| **Icons** | Lucide React 0.525.0 | ✅ Active | |
| **State Management** | Zustand 5 (persist middleware) | ✅ Active | Only user+token persisted |
| **Server State** | TanStack React Query 5 | ⚠️ Installed but NOT USED | Listed in deps but zero imports in codebase |
| **Database** | SQLite (file-based) | ✅ Active | `db/custom.db` |
| **ORM** | Prisma 6.11 | ✅ Active | `db push` (no migrations tracked) |
| **Authentication** | JWT via `jose` 6.2.7 (custom impl) | ⚠️ Partial | Login/register only; no refresh, no verify, no reset |
| **Password Hashing** | bcryptjs 3 | ✅ Active | 12 rounds |
| **Validation** | Zod 4 | ⚠️ Installed but NOT USED | Available but zero imports |
| **Charts** | Recharts 2.15 | ✅ Active | Admin dashboard, organizer analytics |
| **Animations** | Framer Motion 12 | ✅ Active | Page transitions |
| **Toasts** | Sonner 2 | ✅ Active | Primary toast system |
| **Date Utilities** | date-fns 4 | ⚠️ Installed, minimally used | Most date formatting is custom code |
| **Form Handling** | React Hook Form 7 + @hookform/resolvers | ⚠️ Installed but NOT USED | All forms use raw useState |
| **Markdown** | react-markdown 10 | ⚠️ Installed but NOT USED | |
| **Drag & Drop** | @dnd-kit/core + sortable | ⚠️ Installed but NOT USED | |
| **Rich Text Editor** | @mdxeditor/editor | ⚠️ Installed but NOT USED | |
| **Tables** | @tanstack/react-table 8 | ⚠️ Installed but NOT USED | All tables are custom HTML |
| **OTP Input** | input-otp | ⚠️ Installed but NOT USED | |
| **Image Processing** | Sharp 0.34 | ⚠️ Installed but NOT USED | No image upload pipeline |
| **NextAuth** | next-auth 4 | ⚠️ Installed but NOT USED | Custom JWT auth used instead |
| **Themes** | next-themes | ⚠️ Installed but NOT USED | Dark mode CSS exists, no toggle UI |
| **i18n** | next-intl | ⚠️ Installed but NOT USED | |
| **AI SDK** | z-ai-web-dev-sdk | ✅ Available | For AI skill integration |
| **File/Image Storage** | None | ❌ Not implemented | Cover images are URL-only strings |
| **Payment Integration** | None | ❌ Not implemented | `method: 'STRIPE'` is a string label only |
| **Email Service** | None | ❌ Not implemented | No email sending |
| **SMS Service** | None | ❌ Not implemented | |
| **Push Notifications** | None | ❌ Not implemented | |
| **Map/Location** | None | ❌ Not implemented | Lat/lng stored, no map rendering |
| **QR Code** | None | ❌ Not implemented | QR codes are random text strings |
| **PDF Generation** | None | ❌ Not implemented | Download button is a stub |
| **Third-party APIs** | None | ❌ Not implemented | No external API integrations |

### Installed-but-Unused Packages (Technical Debt)

13 packages are installed but have zero imports in the codebase:
- `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`
- `react-markdown`, `@mdxeditor/editor`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- `input-otp`, `next-auth`, `next-themes`, `next-intl`, `sharp`

---

## 2. Current Project Structure

```
/home/z/my-project/
├── .env                          # DATABASE_URL only (no JWT_SECRET!)
├── Caddyfile                     # Gateway config
├── next.config.ts                # Next.js config (standalone, CORS headers, loose TS)
├── package.json                  # Project config (name still "nextjs_tailwind_shadcn_ts")
├── tsconfig.json                 # TypeScript config (noImplicitAny: false)
├── eslint.config.mjs             # ESLint config
├── tailwind.config.ts            # Tailwind config
├── postcss.config.mjs            # PostCSS config
├── prisma/
│   ├── schema.prisma             # 16 models (full schema)
│   └── seed.ts                   # Seed script (4 users, 10 events, 8 ticket types, 3 bookings)
├── db/
│   └── custom.db                 # SQLite database file
├── public/
│   ├── logo.svg                  # Default scaffold logo
│   └── robots.txt                # Default robots.txt
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout (WRONG: Z.ai branding metadata)
│   │   ├── page.tsx              # Single-page shell (header + sidebar + content + footer)
│   │   ├── globals.css           # Tailwind v4 theme (light/dark CSS vars)
│   │   └── api/                  # 19 API route files
│   │       ├── route.ts          # Health check
│   │       ├── auth/route.ts     # Login/Register
│   │       ├── events/
│   │       │   ├── route.ts      # List/Create events
│   │       │   └── [id]/
│   │       │       ├── route.ts  # Get/Update/Delete event
│   │       │       └── book/route.ts  # Book tickets
│   │       ├── admin/
│   │       │   ├── route.ts      # Dashboard stats + user list
│   │       │   ├── users/[id]/route.ts  # User management
│   │       │   └── events/[id]/moderate/route.ts  # Event moderation
│   │       ├── organizer/
│   │       │   ├── route.ts      # Organizer dashboard data
│   │       │   ├── events/
│   │       │   │   ├── route.ts  # Organizer's events
│   │       │   │   └── [id]/analytics/route.ts  # Per-event analytics
│   │       ├── categories/route.ts  # List categories
│   │       ├── notifications/
│   │       │   ├── route.ts      # List user notifications
│   │       │   └── [id]/read/route.ts  # Mark as read
│   │       ├── subscription-plans/route.ts  # List plans
│   │       ├── ads/
│   │       │   ├── route.ts      # List/Create ads
│   │       │   └── [id]/route.ts  # Update/Delete ads
│   │       ├── bookings/route.ts  # List user bookings
│   │       └── tickets/[qrCode]/route.ts  # Validate/Check-in tickets
│   ├── components/
│   │   ├── ui/                  # 35+ shadcn/ui components
│   │   ├── auth-view.tsx        # Login/Register
│   │   ├── public-discover.tsx   # Event discovery
│   │   ├── event-detail.tsx     # Event detail + booking
│   │   ├── admin-dashboard.tsx  # Admin overview
│   │   ├── admin-users.tsx      # User management
│   │   ├── admin-events.tsx     # Event moderation
│   │   ├── admin-plans.tsx      # Plan display (read-only)
│   │   ├── admin-ads.tsx        # Ad management CRUD
│   │   ├── organizer-dashboard.tsx  # Organizer overview
│   │   ├── organizer-events.tsx     # Organizer's event list
│   │   ├── organizer-create-event.tsx  # Event creation form
│   │   ├── organizer-analytics.tsx   # Per-event analytics
│   │   ├── organizer-ads.tsx    # Ad management CRUD (DUPLICATE)
│   │   ├── my-bookings.tsx      # User's bookings
│   │   ├── my-tickets.tsx       # User's tickets (QR as text)
│   │   ├── notifications-view.tsx  # Notifications list
│   │   ├── sidebar-nav.tsx      # Role-based sidebar
│   │   ├── header.tsx           # Top header bar
│   │   └── carousel.tsx         # Unused carousel component
│   ├── stores/
│   │   └── app-store.ts         # Zustand store (auth, nav, UI state)
│   ├── lib/
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── auth.ts             # JWT generation, verify, authenticate, requireRole
│   │   ├── api.ts              # fetch wrapper with auth header
│   │   └── utils.ts            # cn() utility (clsx + tailwind-merge)
│   └── hooks/
│       ├── use-mobile.ts        # Dead code (unused hook)
│       └── use-toast.ts         # Dead code (unused, sonner used instead)
├── examples/
│   └── websocket/               # WebSocket demo (not integrated)
├── tests/                       # Python test scripts (not for this project)
└── tool-results/                # Cached tool output
```

---

## 3. Existing Features — Implementation Status

### Public Platform

| Feature | Status | Details |
|---------|--------|--------|
| Event discovery (browse) | ✅ Fully implemented | Grid layout with pagination |
| Search | ⚠️ Partially implemented | Works but no debounce, no autocomplete |
| Category filter | ✅ Fully implemented | Pill-based category selection |
| Date filter | ⚠️ Partially implemented | 4 preset options (all, today, this week, this month) |
| Category listing | ✅ Fully implemented | From API with event counts |
| Event details | ✅ Fully implemented | Full detail page with metadata |
| Event images | ⚠️ Partially implemented | URL-only, no upload |
| Event videos | ❌ Not implemented | |
| Venue/location | ⚠️ Partially implemented | Stored in DB, no map display |
| Artists/speakers | ❌ Not implemented | |
| Program outline/schedule | ❌ Not implemented | |
| Event sharing | ❌ Not implemented | No social share buttons, no shareable URLs |
| Favorites | ❌ Not implemented | |
| Calendar integration | ❌ Not implemented | No .ics export |
| Featured events | ✅ Fully implemented | Horizontal scroll carousel |
| Related events | ⚠️ Partially implemented | Same-category, silent failure on fetch |
| Reviews (read) | ✅ Fully implemented | Displayed on event detail |
| Reviews (write) | ❌ Not implemented | No rating/submit UI |
| Sorting | ❌ Not implemented | No sort by date/price/popularity |
| Location/city filter | ❌ Not implemented | |

### Organizer Platform

| Feature | Status | Details |
|---------|--------|--------|
| Organizer registration | ⚠️ Partially implemented | Register as PUBLIC, admin upgrades role |
| Organizer verification | ❌ Not implemented | No approval flow |
| SaaS subscription | 🟡 Placeholder | Plans exist in DB, no purchase/enforce |
| Event creation | ⚠️ Partially implemented | Basic form, no image upload, no rich text |
| Event editing | ❌ Not implemented | Create only, no edit form |
| Event publishing | ⚠️ Partially implemented | Auto-sets PENDING, admin approves |
| Event approval | ✅ Fully implemented | Admin approve/reject |
| Event analytics | ⚠️ Partially implemented | Charts render but data source has no writer |
| Ticket management | ⚠️ Partially implemented | Create ticket types, no edit/delete |
| Attendee management | ❌ Not implemented | No attendee list view |
| Staff management | ❌ Not implemented | StaffAssignment model exists, no UI |
| Organizer dashboard | ✅ Fully implemented | Stats, upcoming events, recent bookings |
| Organizer event list | ⚠️ Partially implemented | No edit, no delete, no status filter |

### Ticketing

| Feature | Status | Details |
|---------|--------|--------|
| Free tickets | ✅ Fully implemented | "Register Free" button for free events |
| Paid tickets | ⚠️ Partially implemented | Booking created, no actual payment |
| Multiple ticket types | ✅ Fully implemented | Per-event ticket types with pricing |
| Ticket quantity limits | ✅ Fully implemented | minPerOrder, maxPerOrder enforced |
| Online payment | ❌ Not implemented | Stub only |
| QR code | ❌ Not implemented | Random text string, not actual QR image |
| PDF ticket | ❌ Not implemented | Download button shows toast |
| Mobile ticket | ❌ Not implemented | |
| Ticket verification/scanning | ⚠️ Partially implemented | API endpoint exists, no scanning UI |
| Refunds | ❌ Not implemented | |
| Ticket transfer | ❌ Not implemented | |
| Booking cancellation | ❌ Not implemented | |

### Admin

| Feature | Status | Details |
|---------|--------|--------|
| Dashboard | ✅ Fully implemented | Stats, charts, recent tables |
| User management | ⚠️ Partially implemented | Search, activate/deactivate, role change |
| Organizer management | ❌ Not implemented | No dedicated organizer management |
| Event moderation | ⚠️ Partially implemented | Approve/reject, no reason, no audit |
| Subscription management | 🟡 Placeholder | Read-only display, no CRUD |
| Payment management | ❌ Not implemented | |
| Commission management | ❌ Not implemented | |
| Advertisement management | ✅ Fully implemented | Full CRUD |
| Featured events | ⚠️ Partially implemented | Flag exists, no admin UI to toggle |
| Categories | 🟡 Placeholder | DB + GET, no admin CRUD |
| Reports | ⚠️ Partially implemented | Dashboard charts only |
| Platform settings | 🟡 Placeholder | SystemSetting table exists, no UI |
| Audit logs | ❌ Not implemented | |

---

## 4. Existing User Roles & Permissions

| Role | Value in DB | Nav Items | Can Do |
|------|-----------|-----------|--------|
| **Public User** | `PUBLIC` | Discover Events, My Bookings, My Tickets, Notifications | Browse events, book tickets, view own bookings/tickets |
| **Organizer** | `ORGANIZER` | Dashboard, My Events, Create Event, Analytics, My Ads, My Bookings, My Tickets, Notifications | Everything PUBLIC can do + create/manage own events, view analytics, manage ads |
| **Staff** | `STAFF` | Discover Events, Check Tickets, Notifications | Browse events, check in tickets (but check-in UI doesn't exist) |
| **Super Admin** | `SUPER_ADMIN` | Dashboard, Users, Events, Ads, Plans, Discover Events, Notifications | Full platform management |

### Permission Gaps:
- **No frontend route guards** — sidebar hides nav but `navigate()` can reach any view
- **STAFF role is underutilized** — only 3 nav items, no dedicated check-in UI
- **No permission for organizer to edit events** (only create)
- **No permission for organizer to manage staff** for their events
- **Admin can grant SUPER_ADMIN** to any user (privilege escalation risk)
- **Any organizer can set `isFeatured`** on their own events (should be admin-only)

---

## 5. Database Audit

### Tables (16 models)

| # | Model | Purpose | Records (seeded) |
|---|-------|---------|------------------|
| 1 | `User` | Users with roles | 4 (1 admin, 2 organizers, 1 staff, 1 public) |
| 2 | `StaffAssignment` | Staff assigned to events | 0 |
| 3 | `Category` | Event categories | 10 |
| 4 | `Tag` | Event tags | 17 |
| 5 | `SubscriptionPlan` | Pricing tiers | 4 (Free, Starter, Professional, Enterprise) |
| 6 | `Subscription` | User subscriptions | 2 |
| 7 | `Event` | Events | 10 (8 published, 1 draft, 1 pending) |
| 8 | `EventTag` | Event ↔ Tag junction | 0 (tags created but not linked to events) |
| 9 | `TicketType` | Ticket tiers per event | 18 |
| 10 | `Ticket` | Individual tickets | 3 |
| 11 | `Booking` | Event bookings | 3 |
| 12 | `Payment` | Payment records | 2 |
| 13 | `Review` | Event reviews | 2 |
| 14 | `Notification` | User notifications | 5 |
| 15 | `Advertisement` | Promotional ads | 2 |
| 16 | `EventAnalytics` | Daily event stats | ~240 (30 days × 8 published events) |
| 17 | `SystemSetting` | Platform config | 4 (platform_name, fee_percent, default_currency, support_email) |

### Important Observations:

1. **No migrations tracked.** Using `prisma db push --accept-data-loss` — no migration history, no rollback capability.
2. **No indexes** defined beyond `@unique` and `@id`. No composite indexes for common queries (e.g., `organizerId + status`).
3. **EventTag seeding is missing** — tags are created but never linked to events.
4. **No `REJECTED` status** in Event model — only DRAFT, PENDING, PUBLISHED, CANCELLED, COMPLETED. Admin "reject" sets CANCELLED.
5. **No `OrganizerProfile` model** — organizer info (company, website, social) is not separated from User.
6. **No `EventSchedule`/`Session` model** — no multi-session/multi-day event support.
7. **No `Speaker`/`Artist` model** — no speaker/artist management.
8. **No `Favorite`/`Bookmark` model** — no event favoriting.
9. **No `DiscountCode`/`PromoCode` model** — no promo/discount support.
10. **No `AuditLog` model** — no audit trail for admin actions.
11. **No `Refund` model** — no refund tracking.
12. **No `TicketTransfer` model** — no ticket resale/transfer.
13. **No `EmailTemplate` model** — no email notification templates.
14. **No `Country`/`City` model** — location is just free text fields.
15. **`features` on SubscriptionPlan is a JSON string**, not a separate table — limits querying.
16. **Payment `transactionId` has no unique constraint** — could have duplicates.
17. **No soft-delete pattern** — only User has `isActive`, all other deletes are hard deletes.

### Missing Database Structures for Full Vision:

| Missing Model | Purpose |
|--------------|---------|
| `OrganizerProfile` | Company details, verification, social links |
| `EventSession` | Multi-session event support |
| `Speaker` | Speaker/artist profiles |
| `EventSpeaker` | Speaker ↔ Event junction |
| `EventSchedule` | Day-by-day program outline |
| `Favorite` | User event bookmarks |
| `DiscountCode` | Promo codes with rules |
| `AuditLog` | Admin/moderation action trail |
| `Refund` | Refund requests and processing |
| `TicketTransfer` | Ticket transfer between users |
| `EmailTemplate` | Customizable notification templates |
| `Waitlist` | Sold-out event waitlist |
| `Venue` | Reusable venue database with geocoding |
| `Country`/`City` | Normalized location data |

---

## 6. API Audit — Complete Endpoint Inventory

### Authentication

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| POST | `/api/auth` | None | Login (`action: "login"`) or Register (`action: "register"`) | ⚠️ Partial — no validation, no rate limit, no verify |

### Events

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/events` | Optional | List events (search, filter, paginate) | ✅ Working |
| POST | `/api/events` | ORGANIZER/SUPER_ADMIN | Create event | ⚠️ Partial — race condition on slug, no validation |
| GET | `/api/events/[id]` | None | Get single event detail | ⚠️ Partial — leaks unpublished events |
| PATCH | `/api/events/[id]` | Owner/SUPER_ADMIN | Update event | ⚠️ Partial — no enum validation, featured flag open |
| DELETE | `/api/events/[id]` | Owner/SUPER_ADMIN | Delete event | ⚠️ Partial — hard delete, no cascade check |
| POST | `/api/events/[id]/book` | Required | Book tickets | ⚠️ Partial — race condition, no real payment |

### Admin

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/admin?type=stats` | SUPER_ADMIN | Dashboard statistics | ✅ Working |
| GET | `/api/admin?type=users` | SUPER_ADMIN | User list (search, filter, paginate) | ✅ Working |
| PATCH | `/api/admin/users/[id]` | SUPER_ADMIN | Update user (role, active) | ⚠️ Partial — no escalation guard |
| DELETE | `/api/admin/users/[id]` | SUPER_ADMIN | Deactivate user | ✅ Working (soft delete) |
| PATCH | `/api/admin/events/[id]/moderate` | SUPER_ADMIN | Approve/reject event | ⚠️ Partial — no reason, no audit |

### Organizer

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/organizer?type=dashboard` | ORGANIZER/SUPER_ADMIN | Organizer dashboard data | ✅ Working |
| GET | `/api/organizer/events` | ORGANIZER/SUPER_ADMIN | Organizer's event list | ⚠️ Partial — admin sees only own events |
| GET | `/api/organizer/events/[id]/analytics` | ORGANIZER/SUPER_ADMIN + Owner | Per-event analytics (30d) | ⚠️ Partial — analytics data never written |

### Categories

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/categories` | None | List active categories | ✅ Working |
| POST | `/api/categories` | — | Create category | ❌ Missing |
| PUT | `/api/categories/[id]` | — | Update category | ❌ Missing |
| DELETE | `/api/categories/[id]` | — | Delete category | ❌ Missing |

### Subscriptions

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/subscription-plans` | None | List active plans | ✅ Working |
| POST | `/api/subscription-plans` | — | Create plan (admin) | ❌ Missing |
| PATCH | `/api/subscription-plans/[id]` | — | Update plan (admin) | ❌ Missing |
| DELETE | `/api/subscription-plans/[id]` | — | Delete plan (admin) | ❌ Missing |
| POST | `/api/subscription-plans/subscribe` | — | Subscribe to plan | ❌ Missing |

### Notifications

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/notifications` | Required | List user notifications (last 50) | ⚠️ Partial — no pagination, no unread count |
| PATCH | `/api/notifications/[id]/read` | Required | Mark as read | ✅ Working |
| PATCH | `/api/notifications/read-all` | — | Mark all as read | ❌ Missing |

### Ads

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/ads` | None | List active ads | ✅ Working |
| POST | `/api/ads` | ORGANIZER/SUPER_ADMIN | Create ad | ⚠️ Partial — no validation, no approval |
| PATCH | `/api/ads/[id]` | ORGANIZER/SUPER_ADMIN | Update ad | ⚠️ Partial — NO OWNERSHIP CHECK |
| DELETE | `/api/ads/[id]` | ORGANIZER/SUPER_ADMIN | Delete ad | ⚠️ Partial — NO OWNERSHIP CHECK, hard delete |

### Bookings

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/bookings` | Required | List user's bookings | ⚠️ Partial — no pagination, no filtering |
| POST | `/api/bookings/[id]/cancel` | — | Cancel booking | ❌ Missing |
| GET | `/api/bookings/[id]` | — | Single booking detail | ❌ Missing |

### Tickets

| Method | Endpoint | Auth | Purpose | Status |
|--------|----------|------|---------|--------|
| GET | `/api/tickets/[qrCode]` | ORGANIZER/STAFF/SUPER_ADMIN | Validate ticket | ⚠️ Partial — NO EVENT OWNERSHIP CHECK |
| PATCH | `/api/tickets/[qrCode]` | ORGANIZER/STAFF/SUPER_ADMIN | Check in ticket | ⚠️ Partial — NO EVENT OWNERSHIP CHECK, no audit |

### Missing Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/forgot-password` | Password reset request |
| POST | `/api/auth/reset-password` | Password reset execution |
| POST | `/api/auth/verify-email` | Email verification |
| POST | `/api/auth/refresh-token` | Token refresh |
| POST | `/api/auth/logout` | Token invalidation |
| POST | `/api/upload` | Image/file upload |
| GET | `/api/users/me` | Current user profile |
| PATCH | `/api/users/me` | Update own profile |
| POST | `/api/events/[id]/reviews` | Submit review/rating |
| GET | `/api/events/[id]/schedule` | Event sessions/schedule |
| POST | `/api/events/[id]/favorites` | Add to favorites |
| DELETE | `/api/events/[id]/favorites` | Remove from favorites |
| GET | `/api/organizer/events/[id]/attendees` | Event attendee list |
| POST | `/api/organizer/events/[id]/staff` | Assign staff to event |
| GET | `/api/payments/[bookingId]/checkout` | Initiate payment |
| POST | `/api/payments/webhook/stripe` | Stripe webhook |
| POST | `/api/tickets/[id]/transfer` | Transfer ticket |
| GET | `/api/tickets/[id]/pdf` | Download PDF ticket |
| GET | `/api/admin/revenue` | Revenue reports |
| GET | `/api/admin/audit-logs` | Audit log viewer |
| GET/PUT | `/api/admin/settings` | Platform settings CRUD |
| GET/POST/PUT/DELETE | `/api/admin/categories` | Category management |
| GET/POST/PUT/DELETE | `/api/admin/plans` | Plan management |
| GET | `/api/search/suggestions` | Search autocomplete |

---

## 7. Authentication & Security Audit

### What Exists

| Feature | Status | Details |
|---------|--------|--------|
| Password hashing | ✅ Good | bcryptjs with 12 rounds |
| JWT generation | ✅ Working | HS256 via jose, 7-day expiry |
| JWT verification | ✅ Working | Middleware pattern with authenticate() + requireRole() |
| Role-based access | ✅ Working | 4 roles: PUBLIC, ORGANIZER, STAFF, SUPER_ADMIN |
| Login error message | ✅ Good | Doesn't leak whether email exists |
| Token in localStorage | ✅ Working | Via Zustand persist |
| Auth header injection | ✅ Working | Via apiFetch wrapper |

### Critical Security Issues

| # | Severity | Issue | Impact |
|---|----------|-------|--------|
| 1 | 🔴 CRITICAL | **Hardcoded JWT secret fallback** (`'applecalendar-secret-key-2025'`) | All tokens predictable if env var missing |
| 2 | 🔴 CRITICAL | **No rate limiting** on login or any endpoint | Brute-force, DoS |
| 3 | 🔴 CRITICAL | **No email verification** | Fake accounts, spam |
| 4 | 🔴 CRITICAL | **No input validation framework** | Injection, type confusion |
| 5 | 🔴 CRITICAL | **Ticket booking race condition** | Overselling |
| 6 | 🟠 HIGH | **Unpublished events leak via direct ID access** | Data exposure |
| 7 | 🟠 HIGH | **Ad PATCH/DELETE has no ownership check** | Data manipulation |
| 8 | 🟠 HIGH | **Ticket check-in has no event ownership check** | Unauthorized check-ins |
| 9 | 🟠 HIGH | **Admin can grant SUPER_ADMIN to anyone** | Privilege escalation |
| 10 | 🟠 HIGH | **No token refresh mechanism** | 7-day hard expiry, no rotation |
| 11 | 🟠 HIGH | **No 401 auto-logout in client** | Stale sessions persist |
| 12 | 🟠 HIGH | **No password reset flow** | Account recovery impossible |
| 13 | 🟡 MEDIUM | **CORS set to `*`** | Any origin can call APIs |
| 14 | 🟡 MEDIUM | **`ignoreBuildErrors: true`** in next.config | TypeScript errors silently ignored |
| 15 | 🟡 MEDIUM | **`reactStrictMode: false`** | Missing double-render safety checks |
| 16 | 🟡 MEDIUM | **`noImplicitAny: false`** in tsconfig | Loose type safety |
| 17 | 🟡 MEDIUM | **`log: ['query']` in Prisma client** | All SQL queries logged (perf + security) |
| 18 | 🟡 MEDIUM | **`Math.random()` for QR codes** | Not cryptographically secure |
| 19 | 🟡 MEDIUM | **No request body size limits** | Potential DoS via large payloads |
| 20 | 🟢 LOW | **Event DELETE is hard delete** | No undo, data loss |
| 21 | 🟢 LOW | **No audit logging** | No accountability trail |

### What's Missing for Production Security

- Zod validation on all inputs
- Rate limiting (e.g., `@upstash/ratelimit`)
- CSRF protection (not needed for API-only with JWT, but good practice)
- Content Security Policy headers
- Helmet middleware equivalent
- Request ID tracing
- API request logging
- Account lockout after failed login attempts
- Session/token blacklist for logout
- Password strength requirements enforcement
- Input sanitization (XSS prevention)
- File upload validation (type, size, malware scan)
- Environment variable validation at startup

---

## 8. UI/UX Audit

### Public Interface

| Aspect | Rating | Notes |
|--------|--------|-------|
| Event discovery page | ⭐⭐⭐⭐ | Good hero, filters, grid, pagination, skeletons, empty states |
| Event detail page | ⭐⭐⭐⭐ | Good layout, ticket sidebar, reviews, related events |
| Search experience | ⭐⭐ | No debounce, no autocomplete, no suggestions |
| Mobile responsiveness | ⭐⭐⭐ | Good grid breakpoints, tables overflow on mobile |
| Accessibility | ⭐⭐ | Missing ARIA labels, no keyboard nav on cards, no skip-to-content |
| Performance | ⭐⭐⭐ | Skeleton loading, but double-fetch on filter change |

### Authentication Screens

| Aspect | Rating | Notes |
|--------|--------|-------|
| Login/Register UI | ⭐⭐⭐⭐ | Clean card, tabbed, good validation UX |
| Password reset | ❌ Missing | |
| Social login | ❌ Missing | |
| Email verification | ❌ Missing | |

### User Dashboard

| Aspect | Rating | Notes |
|--------|--------|-------|
| My Bookings | ⭐⭐⭐ | Good cards, no cancel/refund, no pagination |
| My Tickets | ⭐⭐ | QR is text, download is stub |
| Notifications | ⭐⭐⭐ | Good list, no mark-all-read, no real-time |
| User Profile | ❌ Missing | No profile view or edit |

### Organizer Interface

| Aspect | Rating | Notes |
|--------|--------|-------|
| Dashboard | ⭐⭐⭐⭐ | Good stats, upcoming events, recent bookings |
| Event List | ⭐⭐ | No edit, no delete, no status filter |
| Event Creation | ⭐⭐⭐ | Multi-section form, no image upload, no preview |
| Event Editing | ❌ Missing | |
| Analytics | ⭐⭐⭐ | Good charts, no date range, no export |
| Ad Management | ⭐⭐⭐ | Full CRUD, but duplicated component |

### Admin Interface

| Aspect | Rating | Notes |
|--------|--------|-------|
| Dashboard | ⭐⭐⭐⭐ | Stats, charts, recent tables |
| User Management | ⭐⭐⭐ | Search, role/status management, broken pagination |
| Event Moderation | ⭐⭐⭐ | Approve/reject, no reason, no search, no pagination |
| Plan Management | ⭐ | Read-only display |
| Ad Management | ⭐⭐⭐ | Full CRUD |
| Categories | ❌ Missing admin UI | |
| Settings | ❌ Missing UI | |
| Reports | ⭐⭐ | Dashboard charts only |

### Navigation

| Aspect | Rating | Notes |
|--------|--------|-------|
| Sidebar navigation | ⭐⭐⭐⭐ | Role-based, mobile sheet, active states |
| Header | ⭐⭐⭐ | Logo, search (duplicate), bell, avatar dropdown |
| URL routing | ❌ None | All views on `/`, no deep linking, no browser back |
| Breadcrumbs | ❌ Missing | |

### Critical UX Issues

1. **No URL-based routing** — the #1 architectural problem. No shareable links, no SEO, no browser back button.
2. **Metadata is wrong** — page title/description still shows "Z.ai Code Scaffold."
3. **Footer shows on auth page** — odd visual on gradient background.
4. **Tables overflow on mobile** — no horizontal scroll wrapper.
5. **Duplicate search bars** — header and hero both control same state.
6. **Sidebar always dark** regardless of theme state.
7. **No dark mode toggle** — CSS is ready but no UI.
8. **No notification badge** on bell icon.
9. **Admin pagination broken** — page state not sent to API.
10. **`organizer-ads.tsx` duplicates `admin-ads.tsx`** — ~95% identical code.

---

## 9. AppleCalendar Requirements Gap Analysis

### PUBLIC PLATFORM

| Requirement | Current | Gap |
|------------|---------|-----|
| Event discovery | ✅ Implemented | — |
| Search | ⚠️ Basic | Needs debounce, autocomplete, suggestions API |
| Filters | ⚠️ Basic | Needs location/city, price range, sorting |
| Categories | ✅ Implemented | — |
| Event details | ✅ Implemented | — |
| Event images | ⚠️ URL-only | Needs upload, cropping, gallery |
| Event videos | ❌ Missing | Needs video upload/embed |
| Venue/location | ⚠️ Stored | Needs map embed (Google Maps/Leaflet) |
| Artists/speakers | ❌ Missing | Needs Speaker model + UI |
| Program outline | ❌ Missing | Needs EventSession model + UI |
| Event sharing | ❌ Missing | Needs share buttons + URL routing |
| Favorites | ❌ Missing | Needs Favorite model + toggle |
| Calendar integration | ❌ Missing | Needs .ics export |

### ORGANIZER PLATFORM

| Requirement | Current | Gap |
|------------|---------|-----|
| Organizer registration | ⚠️ Basic | Needs dedicated onboarding |
| Organizer verification | ❌ Missing | Needs approval workflow |
| SaaS subscription | 🟡 Placeholder | Entire billing system missing |
| Event creation | ⚠️ Basic | Needs image upload, rich text, preview |
| Event editing | ❌ Missing | Needs edit form |
| Event publishing | ⚠️ Partial | Auto PENDING → admin approve |
| Event approval | ✅ Implemented | — |
| Event analytics | ⚠️ Partial | Data never populated, needs tracking middleware |
| Ticket management | ⚠️ Basic | No edit/delete ticket types |
| Attendee management | ❌ Missing | Needs attendee list + export |
| Staff management | ❌ Missing | Model exists, no UI |

### TICKETING

| Requirement | Current | Gap |
|------------|---------|-----|
| Free tickets | ✅ Implemented | — |
| Paid tickets | ⚠️ Stub | Real payment integration needed |
| Multiple ticket types | ✅ Implemented | — |
| Ticket quantity | ✅ Implemented | — |
| Online payment | ❌ Missing | Stripe integration needed |
| QR code | ❌ Missing | Currently random text |
| PDF ticket | ❌ Missing | Download is a toast stub |
| Mobile ticket | ❌ Missing | Needs PWA or responsive ticket view |
| Ticket verification | ⚠️ Partial | API exists, no scanning UI |
| Refunds | ❌ Missing | |
| Ticket transfer | ❌ Missing | |

### ADMIN

| Requirement | Current | Gap |
|------------|---------|-----|
| Dashboard | ✅ Implemented | — |
| User management | ⚠️ Partial | Missing detail view, invite user |
| Organizer management | ❌ Missing | |
| Event moderation | ⚠️ Partial | Missing reason, audit, pagination |
| Subscription management | 🟡 Read-only | Full CRUD + enforcement needed |
| Payment management | ❌ Missing | |
| Commission management | ❌ Missing | |
| Advertisement management | ✅ Implemented | — |
| Featured events | ⚠️ Flag exists | No admin toggle UI |
| Categories | ❌ No admin UI | CRUD needed |
| Reports | ⚠️ Basic | More comprehensive reporting needed |
| Platform settings | ❌ No UI | |
| Audit logs | ❌ Missing | |

### MOBILE

| Requirement | Current | Gap |
|------------|---------|-----|
| Android | ❌ Not applicable | This is a web app, not Flutter (original spec mismatch) |
| iOS | ❌ Not applicable | Same as above |
| Push notifications | ❌ Missing | Needs PWA + push service |
| Mobile tickets | ⚠️ Responsive | Needs PWA for offline access |
| QR scanner | ❌ Missing | Needs camera API integration |
| Offline ticket access | ❌ Missing | Needs PWA service worker |

> **Note:** The original spec requested Flutter for Android/iOS, but the actual implementation is a Next.js web app. Mobile reach should be achieved via PWA instead of native apps.

---

## 10. SaaS Architecture Assessment

### Current State: ❌ NOT Properly SaaS

The current architecture does **not** properly support multiple event organizers as separate SaaS customers.

### Issues:

1. **No subscription enforcement.** Plans exist in the database but nothing checks whether an organizer has exceeded their plan limits (max events, max tickets). An organizer on the Free plan can create unlimited events.

2. **No billing system.** No Stripe integration, no payment collection, no invoice generation, no usage-based billing.

3. **No data isolation.** All organizers share the same database tables with no row-level security or tenant isolation. Admin can see all data. An organizer cannot be restricted to only their data at the DB level.

4. **No plan-based feature gating.** Features like "Custom branding," "API access," or "Advertisement slots" listed in plan features are not checked anywhere.

5. **No organizer onboarding.** No step-by-step setup, no profile completion, no verification.

6. **No usage tracking.** No mechanism to count events created this month, tickets sold, API calls made, etc.

### What Would Be Needed:

| Component | Status | Description |
|-----------|--------|-------------|
| Subscription model | ❌ Missing | Stripe Customer + Subscription webhooks |
| Plan limit enforcement | ❌ Missing | Middleware checking plan limits before event creation |
| Usage tracking | ❌ Missing | Monthly counters for events, tickets, API calls |
| Billing/invoicing | ❌ Missing | Stripe Billing + invoice PDF generation |
| Feature flags | ❌ Missing | Per-plan feature gate checks |
| Tenant isolation | ⚠️ Partial | Application-level filtering exists (organizerId), no DB-level isolation |
| Organizer profiles | ❌ Missing | Separate public-facing organizer pages |

---

## 11. Development Risks

### Technical Debt (High)

1. **SPA routing on single `/` URL** — will need complete refactor for SEO, sharing, and proper navigation
2. **13 unused npm packages** adding bloat and confusion
3. **~95% code duplication** between `admin-ads.tsx` and `organizer-ads.tsx`
4. **Duplicate utility functions** (formatDistanceToNow, status color maps, slugify)
5. **Dead code** (use-mobile.ts, use-toast.ts, carousel.tsx)
6. **Two competing toast systems** (shadcn toaster vs sonner)
7. **No test suite** — zero tests written
8. **No migration tracking** — `db push --accept-data-loss` is dangerous
9. **`package.json` name is still "nextjs_tailwind_shadcn_ts"** — wrong identity
10. **`layout.tsx` metadata is Z.ai scaffold** — wrong branding

### Architecture Problems (High)

1. **No URL routing** — fundamental architectural flaw for a public-facing platform
2. **No input validation framework** — all ad-hoc if-checks
3. **No error boundary** — unhandled errors crash the whole page
4. **No service layer** — API routes directly contain all business logic
5. **No middleware** — auth/rate-limiting not applied at framework level
6. **No WebSocket/SSE** — no real-time capability
7. **SQLite limitations** — no concurrent writes, no full-text search, no JSON operators

### Security Risks (Critical)

1. Hardcoded JWT secret fallback
2. No rate limiting anywhere
3. No email verification
4. Race conditions on booking and slug generation
5. Unauthorized data access (ads, tickets, unpublished events)
6. Privilege escalation (admin → super admin)
7. CORS wildcard

### Scalability Problems (Medium)

1. SQLite will not scale to production traffic
2. No caching layer (Redis or in-memory)
3. No CDN for static assets
4. No image optimization pipeline
5. Analytics data populated by seed only — no real-time collection
6. No database connection pooling configuration
7. Sequential N+1 DB operations in loops

### Missing Tests (Critical)

- Zero unit tests
- Zero integration tests
- Zero E2E tests
- No test framework configured
- No CI/CD pipeline

---

## 12. Recommended Development Roadmap

Based on the actual current project state, here is the prioritized development roadmap:

---

### PHASE 1 — Foundation Hardening

> Fix the broken basics before adding features.

1. **Fix layout metadata** — Update `layout.tsx` with AppleCalendar branding, OG tags, favicon
2. **Fix `package.json`** name to `applecalendar`
3. **Remove dead code** — Delete `use-toast.ts`, `use-mobile.ts`, unused `carousel.tsx`
4. **Remove unused toast system** — Keep sonner, remove shadcn Toaster from layout, delete toaster component
5. **Enable React strict mode** — Set `reactStrictMode: true` in next.config.ts
6. **Enable TypeScript strict mode** — Set `noImplicitAny: true` in tsconfig.json
7. **Disable Prisma query logging** — Remove `log: ['query']` from db.ts
8. **Set JWT_SECRET in .env** — Generate a proper secret, remove hardcoded fallback
9. **Add Zod validation** — Create validation schemas for auth, events, bookings, ads
10. **Add input validation middleware** — Apply Zod schemas to all POST/PATCH endpoints
11. **Deduplicate code** — Extract shared ad component, shared utility functions
12. **Add error boundary** — Global error boundary in layout.tsx
13. **Fix CORS** — Restrict to actual allowed origins instead of `*`

---

### PHASE 2 — Authentication & Users

> Complete the auth system and user management.

1. **Add password strength validation** — Min 8 chars, uppercase, number, special char
2. **Add email format validation** (Zod)
3. **Implement forgot password flow** — New API endpoints, email service integration
4. **Implement password reset** — Token generation, expiry, verification
5. **Add 401 auto-logout** — In apiFetch, clear auth and redirect to login on 401
6. **Add token refresh** — Refresh token endpoint, auto-refresh before expiry
7. **Create user profile page** — View/edit name, email, avatar, bio, phone
8. **Add image upload for avatars** — Using Sharp + local storage
9. **Create admin user invite flow** — Admin creates user with invitation email
10. **Add rate limiting** — On login (5/min), registration (3/min), general API (100/min)

---

### PHASE 3 — URL Routing & Navigation

> Migrate from SPA state-based routing to proper Next.js App Router pages.

1. **Create `/` route** — Public event discovery (move from component to page)
2. **Create `/events/[slug]` route** — Event detail page (SEO-friendly)
3. **Create `/login` route** — Auth page
4. **Create `/dashboard` route** — Role-based dashboard redirect
5. **Create `/dashboard/events` route** — Organizer/admin events
6. **Create `/dashboard/events/new` route** — Event creation
7. **Create `/dashboard/events/[id]/edit` route** — Event editing
8. **Create `/dashboard/analytics` route** — Organizer analytics
9. **Create `/dashboard/bookings` route** — User bookings
10. **Create `/dashboard/tickets` route** — User tickets
11. **Create `/dashboard/notifications` route** — Notifications
12. **Create `/admin` route** — Admin dashboard
13. **Create `/admin/users` route** — User management
14. **Create `/admin/events` route** — Event moderation
15. **Create `/admin/plans` route** — Subscription management
16. **Create `/admin/ads` route** — Ad management
17. **Create `/admin/settings` route** — Platform settings
18. **Add middleware.ts** — Auth check, role-based route protection, redirects
19. **Update sidebar/header** — Use `next/link` instead of `navigate()`
20. **Add breadcrumbs** — On all dashboard/admin pages

---

### PHASE 4 — Event Management Enhancements

> Complete the event CRUD for organizers.

1. **Add event edit form** — Reuse create form with pre-populated data
2. **Add event draft/publish/submit flow** — DRAFT → PENDING → PUBLISHED
3. **Add event image upload** — Cover image upload with preview and cropping
4. **Add rich text description** — Using @mdxeditor/editor (already installed)
5. **Add tag autocomplete** — Suggest existing tags during event creation
6. **Add event status filter** — In organizer events list
7. **Add event delete with confirmation** — Soft delete with booking check
8. **Add event duplicate/clone** — For recurring events
9. **Add `REJECTED` status** — Separate from CANCELLED
10. **Add rejection reason field** — On admin moderation
11. **Add admin event search** — In admin events list
12. **Add admin event pagination** — In admin events list
13. **Fix event detail access control** — Only PUBLISHED events for public users
14. **Add event slug uniqueness fix** — Transaction-based slug generation

---

### PHASE 5 — Public Event Discovery

> Enhance the discovery experience.

1. **Add search debounce** — 300ms debounce on search input
2. **Add search suggestions API** — Autocomplete endpoint
3. **Add location/city filter** — Dropdown or text input
4. **Add price range filter** — Min/max price slider
5. **Add sort options** — Date, price, popularity, relevance
6. **Add social sharing buttons** — Twitter, Facebook, LinkedIn, WhatsApp, copy link
7. **Add "Add to Calendar" button** — .ics file download
8. **Add favorites/wishlist** — Heart icon on event cards, favorites page
9. **Add map display** — Leaflet or Google Maps embed on event detail
10. **Add review submission** — Star rating + comment form
11. **Add event image gallery** — Multiple images with lightbox
12. **Add featured events admin toggle** — In admin dashboard
13. **Fix double-fetch on filter change** — Single useEffect with deps
14. **Add virtual event link** — Clickable link for virtual events
15. **Add organizer profile link** — On event detail page

---

### PHASE 6 — Ticketing System

> Complete the ticketing workflow.

1. **Fix booking race condition** — Move availability check inside transaction
2. **Add event capacity check** — Validate against event.capacity
3. **Add ticket sale window validation** — Check saleStart/saleEnd
4. **Add idempotency key** — Prevent double-booking on retry
5. **Add booking cancellation** — User-facing cancel button + API
6. **Add refund request flow** — Refund model, admin approval, payment refund
7. **Add ticket type edit/delete** — For organizer
8. **Add ticket transfer** — Transfer to another user
9. **Add waitlist** — For sold-out events
10. **Add promo/discount codes** — Code generation, validation, application
11. **Add dedicated tickets API** — Separate from bookings
12. **Add booking pagination** — In user bookings view
13. **Add booking status filter** — In user bookings view
14. **Fix booking reference format** — Ensure APC- prefix consistency

---

### PHASE 7 — Payment Integration

> Real payment processing.

1. **Set up Stripe account** — Get API keys
2. **Create Stripe checkout session** — New API endpoint
3. **Add Stripe webhook handler** — Payment confirmation, failure handling
4. **Update booking flow** — Redirect to Stripe, webhook confirms booking
5. **Add payment history** — For users and organizers
6. **Add refund processing** — Via Stripe API
7. **Add commission calculation** — Platform fee on each payment
8. **Add organizer payout** — Transfer net amount to organizer
9. **Add payment retry** — For failed payments
10. **Add invoice/receipt** — PDF generation for payment records

---

### PHASE 8 — QR Verification

> Real QR code generation and scanning.

1. **Install QR code library** — `qrcode.react` for generation
2. **Generate real QR codes** — Replace text strings with actual QR images
3. **Use crypto-secure random** — `crypto.randomBytes` for QR code content
4. **Add PDF ticket generation** — Using a PDF library (puppeteer or jspdf)
5. **Add ticket download** — PDF download with QR code, event details, barcode
6. **Add mobile-friendly ticket view** — Optimized for phone screens
7. **Add ticket scanning UI** — For STAFF role (camera API)
8. **Add event ownership check** — On ticket validation/check-in
9. **Add check-in audit trail** — Record who checked in each ticket
10. **Add bulk check-in** — For event entry points
11. **Add offline ticket access** — PWA service worker caching

---

### PHASE 9 — Notifications & Real-time

> Complete notification system.

1. **Add notification badge count** — In header bell icon
2. **Add mark-all-as-read** — Button + API endpoint
3. **Add notification pagination** — For users with many notifications
4. **Add notification preferences** — User can choose which types to receive
5. **Add email notifications** — Via email service (SendGrid, Resend, etc.)
6. **Add real-time updates** — WebSocket or SSE for instant notifications
7. **Add notification templates** — Customizable message templates
8. **Add admin notification settings** — Platform-wide notification config
9. **Add booking confirmation email** — With ticket details
10. **Add event reminder** — Before event start (1 day, 1 hour)

---

### PHASE 10 — Analytics & Advertising

> Complete analytics and ad platform.

1. **Add analytics tracking middleware** — Track views/clicks/bookings on event pages
2. **Add analytics data writer** — Populate eventAnalytics table in real-time
3. **Add date range selector** — In analytics views
4. **Add analytics export** — CSV/PDF download
5. **Add conversion funnel** — Views → clicks → bookings
6. **Add ticket-type breakdown** — In analytics
7. **Add ad impression tracking** — Increment on ad view
8. **Add ad click tracking** — Increment on ad click
9. **Add ad approval workflow** — Admin reviews ads before display
10. **Add ad performance reports** — CTR, conversions for advertisers
11. **Add featured events management** — Admin UI to feature/unfeature
12. **Add comprehensive admin reports** — Revenue, growth, user activity

---

### PHASE 11 — SaaS Subscription & Billing

> Complete the SaaS business model.

1. **Create subscription management UI** — Admin CRUD for plans
2. **Create organizer subscription page** — View current plan, upgrade/downgrade
3. **Integrate Stripe for subscriptions** — Checkout, webhooks, portal
4. **Add plan limit enforcement** — Check limits on event creation, ticket sales
5. **Add usage tracking** — Monthly counters per organizer
6. **Add plan-based feature gating** — Hide/disable features based on plan
7. **Add billing history** — Invoice list, payment history
8. **Add downgrade handling** — What happens when limits are exceeded
9. **Add free trial** — 14-day trial for paid plans
10. **Add organizer verification** — Admin approval for organizer accounts
11. **Add commission management** — Configure platform fee percentage
12. **Add payout management** — Track and process organizer payouts

---

### PHASE 12 — Admin Platform Completion

> Complete all admin functionality.

1. **Add admin categories CRUD** — Create, edit, reorder, deactivate
2. **Add admin plans CRUD** — Create, edit, reorder, features management
3. **Add admin settings page** — Platform name, fee, currency, support email
4. **Add admin audit logs** — Log all admin actions
5. **Add organizer management** — Dedicated section for organizer oversight
6. **Add revenue management** — Detailed revenue reports, commissions, payouts
7. **Add system health dashboard** — Uptime, API performance, error rates
8. **Add data export** — CSV export for users, events, bookings
9. **Add content moderation queue** — Centralized review of flagged content
10. **Add bulk actions** — Bulk approve/reject events, bulk deactivate users

---

### PHASE 13 — Mobile & PWA

> Enable mobile reach.

1. **Add PWA manifest** — App name, icons, theme color
2. **Add service worker** — Offline caching for tickets
3. **Add mobile ticket wallet** — Add-to-home-screen ticket access
4. **Add push notification support** — Via web push API
5. **Optimize mobile layouts** — Tables, forms, charts for small screens
6. **Add touch gestures** — Swipe to navigate, pull to refresh

---

### PHASE 14 — Testing, Security & Production

> Make it production-ready.

1. **Set up testing framework** — Vitest + React Testing Library
2. **Write unit tests** — For all utility functions, stores, hooks
3. **Write API integration tests** — For all endpoints
4. **Write component tests** — For all major components
5. **Write E2E tests** — For critical flows (auth, booking, admin)
6. **Add security headers** — CSP, X-Frame-Options, etc.
7. **Add environment validation** — Fail fast on missing required env vars
8. **Switch from SQLite to PostgreSQL** — For production concurrency
9. **Set up database migrations** — Prisma migrate instead of db push
10. **Add CI/CD pipeline** — Automated testing, linting, deployment
11. **Add monitoring** — Error tracking, performance monitoring
12. **Add rate limiting** — Per-endpoint and per-user
13. **Add request logging** — Structured logging for all API requests
14. **Performance optimization** — Bundle analysis, lazy loading, image optimization
15. **Security audit** — Penetration testing, dependency vulnerability scan

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total files in src/ | ~65 |
| API endpoints | 19 implemented, 25+ missing |
| UI components | 21 custom + 35+ shadcn |
| Database models | 16 |
| Seed records | ~300 total |
| Critical security issues | 6 |
| High-priority bugs | 10 |
| Unused npm packages | 13 |
| Features fully implemented | ~12 |
| Features partially implemented | ~20 |
| Features not implemented | ~40+ |
| Missing database models | 13+ |
| Test coverage | 0% |

---

## READY FOR NEXT DEVELOPMENT PROMPT

The **single highest-priority module to implement next** is:

### **PHASE 1 — Foundation Hardening**

Specifically, the very first task should be:

**"Fix the foundational issues: update layout.tsx metadata to AppleCalendar branding, fix package.json name, set JWT_SECRET in .env, remove dead code, disable Prisma query logging, enable React strict mode, and add a global error boundary. Then implement proper Zod validation schemas and apply them to all POST/PATCH API endpoints."**

This must be done first because:
1. The current branding is wrong (Z.ai scaffold) — users see the wrong name in browser tabs
2. The JWT secret is a hardcoded fallback — a known security vulnerability
3. There is no input validation — the most fundamental security layer is missing
4. Dead code and unused packages add confusion for future development
5. No error boundary means unhandled errors crash the entire application
6. All subsequent feature development will build on this foundation
