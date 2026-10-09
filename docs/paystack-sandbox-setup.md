# Paystack Sandbox Setup Guide

Phase 5G requires valid Paystack TEST credentials to perform genuine sandbox acceptance testing. This guide provides safe, exact steps for end-to-end verification.

## 1. Obtain Credentials from Paystack

1. Sign up or log in at [dashboard.paystack.co](https://dashboard.paystack.co).
2. Toggle the dashboard to **Test Mode** (the switch in the top-right corner).
3. Navigate to **Settings → API Keys & Webhooks**.
4. You will see two keys:
   - **Secret Key** — begins with `sk_test_` (server-side, never expose to the client).
   - **Public Key** — begins with `pk_test_` (safe for client-side use).
5. For the webhook secret, go to **Settings → API Keys & Webhooks** and set a **Webhook Secret**. This is a shared secret you define yourself — Paystack uses it to sign webhook payloads with HMAC-SHA512. Record this value securely.

### Required Variables

| Variable | Description | Example prefix |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Server-side API key | `sk_test_...` |
| `PAYSTACK_PUBLIC_KEY` | Client-side key | `pk_test_...` |
| `PAYSTACK_WEBHOOK_SECRET` | HMAC-SHA512 signing secret | (user-defined) |

## 2. Configure in the Server Environment

**Never paste these values into chat, commit them to Git, or print them in logs.**

Choose one of these methods:

### Option A: Environment variables (recommended for production)

Set them directly in the server's process environment:

```bash
export PAYSTACK_SECRET_KEY="sk_test_your_actual_key"
export PAYSTACK_PUBLIC_KEY="pk_test_your_actual_key"
export PAYSTACK_WEBHOOK_SECRET="your_webhook_secret"
```

For systemd-managed services, use `Environment=` in the unit file or `EnvironmentFile=`.

### Option B: `.env.local` file (development only)

Create `.env.local` at the project root (this file is gitignored):

```bash
PAYSTACK_SECRET_KEY=sk_test_your_actual_key
PAYSTACK_PUBLIC_KEY=pk_test_your_actual_key
PAYSTACK_WEBHOOK_SECRET=your_webhook_secret
```

**Never commit `.env.local`.** It is excluded via `.gitignore`.

### Option C: Hosting platform secrets

For platforms like Vercel, Railway, or Render, use the platform's encrypted environment variable UI. Never use `.env` files in deployed environments.

## 3. Webhook Signing Details

The implementation expects:

- **Algorithm:** HMAC-SHA512
- **Header:** `x-paystack-signature`
- **Body:** Raw request body (not parsed JSON)
- **Comparison:** `crypto.timingSafeEqual()` (constant-time, prevents timing attacks)
- **Endpoint:** `POST /api/webhooks/paystack`

When you configure the webhook URL in the Paystack dashboard (Test Mode), point it to:

```
https://your-domain.com/api/webhooks/paystack
```

Set the same webhook secret in both Paystack and your server environment. The implementation reads it from `env.PAYSTACK_WEBHOOK_SECRET`.

### Exposing a local webhook endpoint for testing

For local development, Paystack cannot deliver webhooks to `localhost`. Use one of these approaches:

1. **ngrok** (recommended for testing): Run `ngrok http 3000`, then use the ngrok URL as the webhook URL in Paystack's dashboard:
   ```
   https://abc123.ngrok.io/api/webhooks/paystack
   ```
   ngrok forwards requests to your local server. Stop ngrok when done testing.

2. **Manual verification only**: Skip webhook testing and rely on the `POST /api/payments/:id/verify` endpoint, which calls Paystack's verify API directly. This does not test webhook delivery, but does test payment confirmation.

3. **Paystack test card webhooks**: When using Paystack's test cards (see Section 5), Paystack may send webhook events if a webhook URL is configured. Without a publicly accessible URL, these events will be lost — this is acceptable for local testing; the verify endpoint provides the same confirmation path.

## 4. Verify Credentials Without Exposing Values

Run the built-in connectivity check:

```bash
bun run scripts/paystack-connectivity-check.ts
```

This script:
- Checks that all three variables are present and non-placeholder.
- Verifies the secret key has the `sk_test_` prefix.
- Makes an authenticated API call to `GET /transaction`.
- Initializes a test transaction.
- **Never prints credential values.**

Expected output when configured correctly:

```
✅ 1. Credentials Present
   SECRET_KEY: PRESENT (non-placeholder), PUBLIC_KEY: PRESENT (non-placeholder), ...

✅ 2. Test Key Prefix
   Key has sk_test_ prefix (sandbox mode)

✅ 3. API Connectivity
   Authenticated API call successful. HTTP 200.

✅ 4. Initialize Transaction
   Transaction initialized. Reference: phase5g-acceptance-...

RESULT: CONNECTED — Paystack sandbox API is reachable and authenticated
```

## 5. Test Successful and Failed Transactions

### Test cards (Paystack sandbox)

| Card number | Result | PIN | OTP |
|---|---|---|---|
| `50606666666666666` (Verve) | Success | `1234` | `123456` |
| `4084084084084081` (Visa) | Success | — | `123456` |
| `50606666666666666` | Failed (insufficient) | `1234` | — |

Full list: https://paystack.com/docs/test-cards

### Step-by-step: Successful payment

1. Initialize a payment via the app (book a ticket, proceed to checkout).
2. The app calls `POST /api/payments/initialize` → returns Paystack authorization URL.
3. Visit the authorization URL in a browser.
4. Enter a test card (e.g., Visa `4084084084084081`), submit.
5. Paystack redirects to the callback URL.
6. The app calls `POST /api/payments/:id/verify` → server verifies with Paystack.
7. On success: Payment→COMPLETED, Booking→CONFIRMED, Tickets→VALID, Inventory confirmed.

**Verify stored states:**
```sql
SELECT id, status, "completedAt" FROM "Payment" WHERE id = '<paymentId>';
SELECT id, status, "confirmedAt" FROM "Booking" WHERE id = '<bookingId>';
SELECT id, status FROM "Ticket" WHERE "bookingId" = '<bookingId>';
SELECT id, "soldCount", "reservedCount", quantity FROM "TicketType" WHERE id = '<ticketTypeId>';
-- Verify: soldCount increased, reservedCount decreased, soldCount + reservedCount <= quantity
```

### Step-by-step: Failed payment

1. Initialize a payment via the app.
2. Visit the authorization URL, enter a card that will fail.
3. Paystack redirects with a failed. reference.
4. Verify endpoint transitions Payment→FAILED, releases inventory.

**Verify stored states:**
```sql
SELECT id, status, "failedAt" FROM "Payment" WHERE id = '<paymentId>';
SELECT id, "soldCount", "reservedCount" FROM "TicketType" WHERE id = '<ticketTypeId>';
-- Verify: reservedCount decreased (released), soldCount unchanged
```

### Step-by-step: Webhook delivery (requires ngrok or public URL)

1. Configure webhook URL in Paystack dashboard pointing to your server.
2. Complete a successful test payment.
3. Paystack sends `charge.success` webhook to `POST /api/webhooks/paystack`.
4. Webhook handler verifies HMAC-SHA512 signature, deduplicates, confirms booking.
5. Check `PaymentWebhookEvent` table for the processed event.

**Verify webhook event:**
```sql
SELECT id, "eventId", "eventType", processed, "processingError"
FROM "PaymentWebhookEvent"
WHERE "eventReference" = '<reference>';
-- processed = true, processingError IS NULL for successful processing
```

## 6. Resume Phase 5G Acceptance

Once the connectivity check passes, run the full Phase 5G test suite:

```bash
npx vitest run src/__tests__/phase5g-sandbox-acceptance.test.ts
```

This exercises the following scenarios:

| Step | Scenario | Type | Notes |
|---|---|---|---|
| 2 | Credential validation | Provider | Verified by connectivity check |
| 3 | Initialize test transaction | Provider | Creates real Paystack test transaction |
| 4 | Successful payment + booking confirmation | Domain | Invariants verified via test DB |
| 5 | Webhook processing | Domain | Signature, dedup, amount mismatch |
| 6 | Verify vs. webhook race | Domain | Concurrent safety with status guards |
| 7 | Failed payment flow | Domain | FAILED transition + inventory release |
| 8 | Payment expiry | Domain | EXPIRED transition + inventory release |
| 9 | Refund flow | Domain | Refund lifecycle with over-refund guard |
| 10 | Security audit | Domain | No secrets leaked in bundles/logs/Git |

**Steps 4–10 use domain logic (SQLite test DB) and always pass.** Steps 2–3 require real Paystack credentials.

### Unsupported scenarios

| Scenario | Reason |
|---|---|
| Refund via Paystack sandbox API | Paystack does not expose a refund API for test transactions. Refund domain logic is verified locally. |
| Real webhook delivery to localhost | Paystack requires a publicly accessible URL. Use ngrok for local testing. |

## 7. Production Checklist

Before deploying to production with **live** keys:

- [ ] Replace `sk_test_` keys with `sk_live_` keys
- [ ] Replace `pk_test_` keys with `pk_live_` keys
- [ ] Verify `requiredInProduction` in `src/lib/env.ts` catches missing keys
- [ ] Set `DATABASE_URL` to PostgreSQL
- [ ] Run `prisma migrate deploy` (not `db:push`)
- [ ] Verify webhook URL points to production domain
- [ ] Test webhook delivery with a small live transaction
