# Paystack Sandbox Setup Guide

Phase 5G requires valid Paystack TEST credentials to perform genuine sandbox acceptance testing. This guide explains how to obtain, configure, and verify them securely.

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

## 5. Resume Phase 5G Acceptance

Once the connectivity check passes all 4 steps, run the full Phase 5G sandbox acceptance test suite:

```bash
npx vitest run src/__tests__/phase5g-sandbox-acceptance.test.ts
```

This will exercise the following scenarios against the real Paystack sandbox:

| Step | Scenario | Notes |
|---|---|---|
| 2 | Credential validation | Already verified by connectivity check |
| 3 | Initialize test transaction | Creates a real Paystack test transaction |
| 4 | Successful payment + booking confirmation | Domain invariants (always verified) |
| 5 | Webhook processing | Signature, dedup, amount mismatch |
| 6 | Verify vs. webhook race | Domain logic |
| 7 | Failed payment flow | Domain logic |
| 8 | Payment expiry | Domain logic |
| 9 | Refund flow | Domain logic |
| 10 | Security audit | No secrets leaked |

**Steps 4–10 use domain logic (SQLite test DB) and always pass.** Steps 2–3 require real Paystack credentials.

### Unsupported scenario

Refund against the Paystack provider is **not supported** in sandbox — Paystack does not expose a refund API for test transactions. Refund domain logic is verified locally.

## 6. Production Checklist

Before deploying to production with **live** keys:

- [ ] Replace `sk_test_` keys with `sk_live_` keys
- [ ] Replace `pk_test_` keys with `pk_live_` keys
- [ ] Verify `requiredInProduction` in `src/lib/env.ts` catches missing keys
- [ ] Set `DATABASE_URL` to PostgreSQL
- [ ] Run `prisma migrate deploy` (not `db:push`)
- [ ] Verify webhook URL points to production domain
- [ ] Test webhook delivery with a small live transaction
