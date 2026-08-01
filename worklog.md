# AppleCalendar Worklog

## Task 1: Project Rename — ApoCalendar → AppleCalendar

**Date:** 2025
**Task ID:** 1
**Description:** Rename all references from ApoCalendar to AppleCalendar across the entire project.

### Changes Made:

**UI Branding (5 files):**
- `src/components/header.tsx` — Logo text → AppleCalendar
- `src/components/sidebar-nav.tsx` — Desktop & mobile sidebar headings → AppleCalendar
- `src/components/auth-view.tsx` — Auth card logo → AppleCalendar
- `src/components/my-tickets.tsx` — Ticket branded header → AppleCalendar
- `src/app/page.tsx` — Footer copyright → AppleCalendar

**Backend (2 files):**
- `src/lib/auth.ts` — JWT fallback secret → applecalendar-secret-key-2025
- `src/app/api/events/[id]/book/route.ts` — Booking ref prefix → APC-

**State Management (1 file):**
- `src/stores/app-store.ts` — Zustand persist name → applecalendar-store

**Database Seed (1 file):**
- `prisma/seed.ts` — Admin email → admin@applecalendar.com, support email → support@applecalendar.com, platform_name → AppleCalendar, booking refs → APC-

**Database:** Reset and re-seeded with updated data.

---

## Task 3: Create All API Route Files

**Date:** 2025
**Task ID:** 3
**Description:** Create all backend API route files for the AppleCalendar SaaS event platform.

### Files Created (18 API routes):

1. **`src/app/api/auth/route.ts`** — POST /api/auth
   - Handles login and register actions
   - Password hashing with bcryptjs, JWT token generation
   - Returns user object with token

2. **`src/app/api/events/route.ts`** — GET/POST /api/events
   - GET: List events with search, category, date filter, featured, pagination
   - Public users see only PUBLISHED events; authenticated organizers/admins see all
   - Includes category, ticketTypes (with soldCount), organizer, _count{reviews, bookings}
   - POST: Create event (ORGANIZER/SUPER_ADMIN), auto-generate slug, create tags and ticket types

3. **`src/app/api/events/[id]/route.ts`** — GET/PATCH/DELETE /api/events/:id
   - GET: Single event with full details including reviews, tags, ticket types
   - PATCH: Update event (owner or admin), handle tag updates, slug regeneration
   - DELETE: Delete event (owner or admin)

4. **`src/app/api/events/[id]/book/route.ts`** — POST /api/events/:id/book
   - Book tickets with availability check, min/max per order validation
   - Creates booking, tickets with QR codes, payment record, and notification
   - Booking ref format: APC-{timestamp}-{random}, QR code format: QR-{bookingRef}-{randomString}

5. **`src/app/api/admin/route.ts`** — GET /api/admin?type=stats|users
   - Stats: totalUsers, totalEvents, totalBookings, totalRevenue, recentUsers, recentEvents, eventsByStatus, revenueByMonth
   - Users: paginated user list with search and role filter

6. **`src/app/api/admin/users/[id]/route.ts`** — PATCH/DELETE /api/admin/users/:id
   - PATCH: Update user isActive and role (SUPER_ADMIN only)
   - DELETE: Soft delete (deactivate) user

7. **`src/app/api/admin/events/[id]/moderate/route.ts`** — PATCH /api/admin/events/:id/moderate
   - Approve (PUBLISHED) or reject (CANCELLED) events
   - Sends notification to organizer

8. **`src/app/api/categories/route.ts`** — GET /api/categories
   - List all active categories ordered by sortOrder, with event count

9. **`src/app/api/notifications/route.ts`** — GET /api/notifications
   - Auth required, return user's notifications ordered by createdAt desc

10. **`src/app/api/notifications/[id]/read/route.ts`** — PATCH /api/notifications/:id/read
    - Mark notification as read (ownership check)

11. **`src/app/api/organizer/route.ts`** — GET /api/organizer?type=dashboard
    - Dashboard: myEvents count, totalBookings, totalRevenue, upcomingEvents, recentBookings
    - Includes ticket type aggregate data for upcoming events

12. **`src/app/api/organizer/events/route.ts`** — GET /api/organizer/events
    - Organizer's events with ticketTypes, bookingCount, reviewCount, pagination

13. **`src/app/api/organizer/events/[id]/analytics/route.ts`** — GET /api/organizer/events/:id/analytics
    - 30 days of daily analytics (views, clicks, bookings, revenue)
    - Fills missing dates with zeros, includes totals and ticket summary

14. **`src/app/api/subscription-plans/route.ts`** — GET /api/subscription-plans
    - List all active plans ordered by sortOrder

15. **`src/app/api/ads/route.ts`** — GET/POST /api/ads
    - GET: Active ads with optional position filter
    - POST: Create ad (ORGANIZER/SUPER_ADMIN)

16. **`src/app/api/ads/[id]/route.ts`** — PATCH/DELETE /api/ads/:id
    - Update or delete ad (ORGANIZER/SUPER_ADMIN)

17. **`src/app/api/bookings/route.ts`** — GET /api/bookings
    - Auth required, user's bookings with event, tickets, payment info

18. **`src/app/api/tickets/[qrCode]/route.ts`** — GET/PATCH /api/tickets/:qrCode
    - GET: Validate/check ticket (ORGANIZER/STAFF/SUPER_ADMIN)
    - PATCH: Check in ticket (set USED, checkedInAt)

### Technical Details:
- All routes use `NextRequest`/`NextResponse` from `next/server`
- Authentication via `authenticate()` and `requireRole()` from `@/lib/auth`
- Proper error handling with try/catch, AuthError catching with correct status codes
- All dynamic route params use `{ params }: { params: Promise<{ id: string }> }` with `await params`
- Database access via `db` from `@/lib/db`
- Lint passes cleanly with zero errors

---

## Task 4: Create Complete Frontend (19 Files)

**Date:** 2025
**Task ID:** 4
**Description:** Build the complete single-page application frontend for AppleCalendar, a SaaS event management platform.

### Files Created (19 files):

1. **`src/lib/api.ts`** — API helper
   - Generic `apiFetch<T>()` with automatic Authorization header injection from Zustand store

2. **`src/components/auth-view.tsx`** — Login/Register view
   - Tabbed login/register forms with shadcn Tabs
   - Password visibility toggle, validation, error handling via toast
   - Emerald gradient background card design

3. **`src/components/public-discover.tsx`** — Main event discovery portal
   - Hero section with search bar (emerald/teal gradient)
   - Category filter pills, date filter buttons
   - Featured events horizontal scroll carousel
   - Responsive event grid (1/2/3 cols) with skeleton loading
   - Pagination, ticket sold progress bars, empty states

4. **`src/components/event-detail.tsx`** — Full event detail view
   - Hero image with gradient overlay
   - Date/time/location info cards (virtual event support with Globe icon)
   - Category badges, tags, description, reviews section
   - Ticket type sidebar with Book dialog (quantity selector)
   - Free event 'Register Free' support
   - Framer Motion fade-in animation, related events

5. **`src/components/admin-dashboard.tsx`** — Super Admin dashboard
   - 4 stat cards (Users, Events, Bookings, Revenue) with colored icon backgrounds
   - Revenue line chart (recharts, 6 months)
   - Events by status horizontal bar chart
   - Recent users and events tables

6. **`src/components/admin-users.tsx`** — User management
   - Searchable user table with role/status badges
   - Toggle active/inactive, change role with AlertDialogs
   - Pagination support

7. **`src/components/admin-events.tsx`** — Event moderation
   - All events table with colored status badges
   - Approve/reject actions for PENDING events
   - View event detail navigation

8. **`src/components/admin-plans.tsx`** — Subscription plan management
   - Pricing card grid with plan details
   - Feature lists, subscriber counts, plan icons

9. **`src/components/organizer-dashboard.tsx`** — Organizer dashboard
   - Welcome banner with gradient
   - Stats cards, upcoming events grid, recent bookings table

10. **`src/components/organizer-events.tsx`** — Organizer's event list
    - Event cards with status badges, tickets sold, booking count
    - View and Analytics action buttons
    - Create Event CTA

11. **`src/components/organizer-create-event.tsx`** — Event creation form
    - Multi-section form: Basic Info, Date & Time, Venue (physical/virtual toggle), Ticketing
    - Dynamic ticket type list (add/remove)
    - Form validation, category fetch from API

12. **`src/components/organizer-analytics.tsx`** — Event analytics
    - Event selector dropdown
    - Stats cards (Views, Clicks, Bookings, Revenue)
    - Views line chart, Bookings bar chart, Revenue area chart (30 days)

13. **`src/components/my-bookings.tsx`** — User bookings list
    - Booking cards with event cover, status badges, amounts
    - Color-coded statuses (Confirmed/Pending/Cancelled/Refunded)

14. **`src/components/my-tickets.tsx`** — Ticket display with QR codes
    - Ticket cards with branded header
    - QR code display as monospace styled div
    - Download button (placeholder toast)

15. **`src/components/admin-ads.tsx`** & **`src/components/organizer-ads.tsx`** — Ad management
    - Ads table with title, position, status, impressions, clicks, CTR
    - Create/Edit dialog, Delete confirmation

16. **`src/components/notifications-view.tsx`** — Notifications
    - Type-based icons and color coding
    - Read/unread indicator, click-to-read, navigate to event

17. **`src/components/sidebar-nav.tsx`** — Navigation sidebar
   - Desktop: fixed dark sidebar (bg-zinc-900) with role-based nav items
   - Mobile: Sheet component triggered by hamburger
   - User avatar/name, active state highlighting, logout
   - Roles: PUBLIC, ORGANIZER, STAFF, SUPER_ADMIN each have unique nav items

18. **`src/components/header.tsx`** — Top header bar
   - Hamburger menu (mobile), AppleCalendar gradient logo
   - Search input (on discover view), notification bell
   - User avatar dropdown (My Bookings, Notifications, Logout)
   - Login/Register buttons when unauthenticated

19. **`src/app/page.tsx`** — Main page (ONLY route)
   - Layout: Header + SidebarNav + AnimatePresence page transitions + sticky footer
   - Renders correct component based on `currentView` from Zustand store
   - Framer Motion fade + slide transitions between views

### Architecture:
- **Single-page app**: Only `/` route, all views rendered via Zustand `currentView` state
- **State management**: Zustand store for auth, navigation, UI state (search, filters, sidebar)
- **API layer**: Centralized `apiFetch<T>()` with auto auth headers
- **Charts**: Recharts with shadcn ChartContainer/ChartTooltip
- **Design**: Emerald/teal primary colors, responsive mobile-first, skeleton loading, empty states
- **Components**: All shadcn/ui (Card, Button, Badge, Table, Dialog, Sheet, Tabs, Select, etc.)
- **Lint**: Passes cleanly with zero errors
