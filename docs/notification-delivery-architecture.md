# Notification Delivery Architecture — Provider Readiness (Phase 6D)

> Status: architecture document only. **No real email/SMS provider is activated
> by this phase.** All channels remain mock-only until the operator explicitly
> approves provider integration and secrets are provisioned outside chat.

## 1. Current state (verified at commit 5d1ccca + Phase 6D fixes)

| Capability | State |
|---|---|
| Adapter interface | `NotificationChannel` (`src/lib/services/notification-channels.ts`) — `channel` id + `send()` that must not throw; `ChannelDeliveryResult` carries `permanent` flag for error taxonomy |
| Registry | `registerChannel` / `getChannel` / `getAllChannels`; `initializeDefaultChannels()` registers **InApp only** |
| Dispatch | `dispatchNotification()` — dedup via `dedupKey` unique + P2002 race handling; per-channel preference enforcement (missing row → `DEFAULT_CHANNEL_ENABLED`: in-app ON, email/SMS OFF); status machine PENDING → SENT / FAILED / SKIPPED |
| Failure isolation | All dispatch sites run after the primary transaction commits, wrapped in try/catch — verified at all 11 call sites |
| Consent defaults | Aligned in 3 layers (registration init, dispatch fallback, UI seed): email/SMS default OFF |
| Large fan-out | Event cancellation uses bounded-concurrency chunks of 50 (Phase 6D N-14) |
| Retry | **None yet** — transient channel failures leave rows PENDING forever (harmless today: in-app cannot fail; blocking for real providers) |

## 2. Gap analysis for real providers (go-live checklist)

Before registering a real `EmailChannel`/`SmsChannel`, the following must land:

1. **Outbox sweeper (retry worker)** — see §3. Without it, any provider
   outage silently drops notifications.
2. **Provider message-ID persistence** — add nullable `providerMessageId
   String?` to `Notification` (additive migration) and persist
   `ChannelDeliveryResult.providerId`; today it is discarded, making
   delivery tracing/disputes impossible.
3. **Status semantics split** — `deliveredAt` currently written on `SENT`
   (provider accepted). Real DELIVERED should only be set from provider
   webhooks (SendGrid events, Twilio status callbacks).
4. **Error taxonomy mapping** — provider adapter must map hard bounces /
   invalid numbers to `permanent: true` (no retry), 5xx/timeouts to
   `permanent: false` (retry).
5. **SMS consent hardening** — gate SMS opt-in on a *verified* phone number
   (verify-on-enable flow). `user.phone` is unverified today.
6. **Rate limits per provider** — providers throttle (SendGrid/Twilio
   limits); the sweeper must respect provider-specific ceilings.
7. **Separate dispatch credentials** — provider API keys provisioned as
   environment secrets by the operator (never in chat/repo).

## 3. Queue options (documented, not implemented)

| Option | Infra required | Failure modes | Operational cost | When to choose |
|---|---|---|---|---|
| **A. In-process outbox sweeper** (recommended Phase 1) | None — `setInterval`/cron hitting `POST /api/notifications/dispatch-pending` (admin-gated) or a lazy sweep on dispatch | Process crash loses in-flight timer state (safe: rows stay PENDING, next boot resumes); duplicate sends possible after crash mid-send (mitigated by dedupKey on the notification row; email/SMS would re-send the same content — acceptable, idempotent-ish) | ~Zero. One sweeper loop per instance | Volume < ~10k dispatches/day, single/few instances |
| **B. Postgres-backed job table** (SKIP LOCKED) | Postgres (already present) + worker loop (same process or sidecar) | Row-locked jobs crash-safe (unclaimed rows retried); needs attempts/backoff columns + dead-letter marking | Low — one table + a worker loop; no new moving parts | Multi-instance deploys, volume < ~50k/day |
| **C. External broker (BullMQ/Redis, SQS)** | Redis/SQS + worker deployment + monitoring | Broker outage stalls delivery (alerts needed); at-least-once semantics → duplicate email/SMS possible; ordering not guaranteed | Medium — new stateful infra, dashboards, version upgrades | Volume > ~50k/day or strict latency SLOs |

**Recommendation:** Option A now, Option B when multi-instance deployment
arrives. Option C is explicitly not justified at current scale.

Design constraints that hold for every option:
- The outbox pattern (state committed in the same DB transaction as business
  data, delivery attempted separately) preserves the Phase 5G/6A invariant:
  notification failure must never roll back booking/payment/refund state.
- Retries must be capped (e.g. 5 attempts, exponential backoff 1m→2m→4m→8m→16m)
  with dead-letter to FAILED + an ops-visible log line.
- The sweeper must claim rows atomically (e.g. conditional `updateMany` on
  status PENDING AND attempts < cap) so parallel instances never double-send.

## 4. Large-event fan-out

Phase 6D replaced the sequential per-booker loop with bounded concurrency
(chunks of 50). Measured cost: ~5 queries/booker, now ~50 in flight. At
1,000 bookers this is seconds, not tens of seconds. If this remains slow in
practice, migrate the fan-out itself to the queue (enqueue one
`notify-event-cancelled` job, respond 202) — the dedupKey design already
makes re-runs safe.

## 5. Operator decision points (require explicit approval)

1. Choice of email provider (SendGrid/SES/Postal/SMTP) and SMS provider
   (Twilio/Africa's Talking) + secrets provisioning.
2. Whether verification/reset emails become mandatory (currently links are
   never delivered outside dev — the flows work but are decorative).
3. Domain + DKIM/SPF setup for email sending reputation.
4. Data-protection review for storing provider message IDs.
