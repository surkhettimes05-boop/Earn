# EARN front-end rebuild plan

## What exists
The repository now has a real Prisma/PostgreSQL transaction API. The current `index.html` is a prototype and mixes UI, API calls, copy and role logic in one file.

### Existing API routes
- Auth: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/me`
- Campaigns: `GET /api/campaigns`, `POST /api/campaigns`, publish/pause/resume/close, `GET /api/business/campaigns`
- Earner selling: `POST /api/campaigns/:id/start`
- Orders: idempotent `POST /api/orders`, `GET /api/me/orders`, `GET /api/business/orders`
- Buyer: `GET /api/customer/order?token=...`, confirm order, submit payment reference, verify delivered quantity with delivery PIN
- Business: accept, ready for pickup, cancel
- EARN/admin operations: confirm payment, assign logistics, pickup, out for delivery, delivered, complete return, mark refund, settlements paid, `GET /api/admin/orders`
- Disputes: `POST /api/orders/:id/dispute`
- Money: `GET /api/me/earnings`; legacy reward payable/paid routes also exist

## Front-end build
- Replace the prototype with a mobile-first role shell.
- Public landing/auth.
- Earner tabs: Home, Sell, Orders, Money.
- Business tabs: Campaigns, Orders, Money.
- Separate `/admin` experience for ADMIN only.
- Public `/confirm-order?token=...` buyer flow.
- Add `lib/client.js` as the only API adapter and `lib/strings.js` as the copy source so Nepali can be added later.
- Use only ORDER campaigns in the primary UI. Existing non-ORDER backend capability remains untouched.
- Use plain-language status labels and a seven-stage tracker.
- Use existing idempotency key on order creation.

## API gaps / deliberate limitations
1. There is no SMS provider endpoint. The API returns a customer confirmation URL; the UI will use the device Share API/copy link and clearly say the link must be sent to the buyer manually.
2. There is no real payment gateway or payment-initiation endpoint. Buyer payment is currently a manual bank/QR reference submission followed by ADMIN confirmation. The UI must not pretend that money was automatically charged or held.
3. There is no payout/withdrawal request endpoint. Earner withdrawal is displayed but disabled; ADMIN settlement marking remains the actual payout reconciliation mechanism.
4. There is no business-specific money/ledger summary endpoint. Business Money will derive visible settlement information from `/business/orders`.
5. There is no order-detail/event-history GET endpoint for earner/business. Current order list responses expose payment/logistics/settlements/open disputes but not `OrderEvent` history. Timeline is derived from current status, not a full audit-log screen.
6. There is no admin dispute-resolution endpoint; admin can see open disputes in `/admin/orders`, but cannot resolve/reject them through an API yet. Resolution controls will be visibly unavailable rather than mocked as successful.
7. Buyer “I did not place this order” is now supported by `POST /api/customer/reject-order`. Before payment proof it cancels and releases capacity; if a manual payment reference was already submitted it moves the order to `DISPUTED`, creates an open dispute, and marks the payment `REFUND_PENDING` instead of silently cancelling.
8. Dispute photo upload/storage does not exist, so the dispute form supports reason + note only.
9. Business campaign API still supports FIXED_ORDER/PERCENT_GMV and non-ORDER campaign types. The new primary UI intentionally sends only ORDER + PER_UNIT.
10. The duplicate/shadowed `POST /orders` handler has been removed. The surviving handler is protected by real-DB integration coverage on this branch.

No fake successful payment, payout, SMS, photo upload or dispute-resolution behavior will be presented as real.


## Order hardening verification (Steps 1–5)

### Test database safety
Integration tests use `TEST_DATABASE_URL` only. The runner refuses to start when it is unset, equals `DATABASE_URL`, or neither the hostname nor database name contains `test`. The Prisma schema currently declares only `DATABASE_URL`; there is no `directUrl`, `shadowDatabaseUrl`, or Prisma config file. As defense in depth, the integration child environment overrides `DATABASE_URL`, `DIRECT_URL`, `SHADOW_DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and `POSTGRES_URL_NON_POOLING` with the validated test URL.

`npm test` remains database-free. `npm run test:integration` loads the local uncommitted `.env` on Node 22+, validates the test URL, runs `prisma migrate deploy` against that database, then runs the real HTTP/Prisma integration suite. Vercel does not invoke this script during install or preview deployment.

### Campaign-cap concurrency
The removed handler's rule was: count rewards for the campaign whose status is `EARNED`, `PAYABLE`, or `PAID`; reject when that count is greater than or equal to `campaign.cap`.

The restored handler strengthens the reservation point so concurrency is actually safe: every order not in `CANCELLED` or `RETURNED` consumes one campaign slot. The handler starts a Prisma transaction, obtains a PostgreSQL `SELECT ... FOR UPDATE` row lock on the Campaign, then checks duplicate buyer and reserved-slot count and inserts the Order + `ORDER_SUBMITTED` event before releasing the lock. A row lock was chosen over serializable retries because all competing order creations for a campaign have a natural single lock row; it serializes only that campaign and avoids transaction-wide serialization failures. This is necessary for the requested “two requests for the last slot, exactly one succeeds” invariant; the old reward-only count could not provide that invariant because a newly submitted order has no Reward yet.

### Verified POST /api/orders response contracts
First creation returns HTTP 201:
```json
{
  "id": "<order id>",
  "...": "the serialized Order fields; BigInt values are JSON strings",
  "productSubtotalPaisaSnapshot": "440000",
  "totalCommissionPaisaSnapshot": "12000",
  "merchantSettlementPaisaSnapshot": "428000",
  "customerConfirmationPath": "/confirm-order?token=<one-time raw token>"
}
```
The raw confirmation token exists only in that response. PostgreSQL stores only `customerConfirmTokenHash`, a SHA-256 hash.

An idempotent retry by the same earner returns HTTP 200 with the existing serialized Order row:
```json
{
  "id": "<same order id>",
  "...": "the existing serialized Order fields; BigInt values are JSON strings"
}
```
It cannot return the original `customerConfirmationPath` because the raw token is deliberately not stored. A different earner reusing the key receives HTTP 409.

For a lost buyer link, the owning earner can call `POST /api/orders/:id/reissue-confirmation` while the order is still `SUBMITTED`. It returns HTTP 200:
```json
{
  "id": "<order id>",
  "status": "SUBMITTED",
  "customerConfirmationPath": "/confirm-order?token=<new raw token>"
}
```
The previous token hash is replaced, so the previous link becomes invalid, and `CUSTOMER_LINK_REISSUED` is written to OrderEvent.

### Local verification commands
Use a dedicated PostgreSQL test database/Neon test branch. Keep the URL only in local `.env`; never commit it.

```bash
git checkout test/order-http-hardening
git pull
npm install
```

In local `.env`:
```dotenv
TEST_DATABASE_URL="postgresql://...test-host.../earn_test?sslmode=require"
```
The host or database name must contain `test`, and this URL must not equal `DATABASE_URL`.

Run the database-free suite:
```bash
npm test
```

Run migrations and the real HTTP/Prisma integration suite against TEST_DATABASE_URL:
```bash
npm run test:integration
```

For an explicit manual migration/seed check against the test database, set `DATABASE_URL` to the same safe test URL only in that shell, then run:
```bash
npm run db:deploy
npm run db:seed
```
Do not point those commands at production while validating this branch.

### Integration coverage added
`tests/orders.http.test.js` calls the exported real `api/index.js` handler and a real Prisma client. It covers: successful snapshots + exactly one ORDER_SUBMITTED event; idempotent retry without duplicate row/event; duplicate buyer; cap exceeded; two concurrent requests for the last slot with exactly one success; attribution owned by another earner; and buyer-link re-issue invalidating the old token.

### What was run here versus not run
Repository files and branch state were inspected through GitHub, and all changes were written only to `test/order-http-hardening`. This environment did not execute npm, Prisma migrations, or PostgreSQL integration tests, so no runtime pass is claimed. The required local gates are `npm test` and `npm run test:integration`.

### Backend endpoints to build next, ranked by trust impact
1. Token-scoped buyer **“I didn't place this order”** rejection endpoint.
2. Admin dispute resolve/reject endpoint with immutable resolution event.
3. Read-only order event/audit-history endpoint for authorized earner/business/customer views.
4. Real payment-provider initiation/webhook integration so payment confirmation is not manual.
5. Withdrawal request/payout endpoint and payout state machine.
6. Business settlement/ledger endpoint.
7. Secure dispute attachment/object-storage endpoint.
8. SMS/WhatsApp delivery service for buyer confirmation links.
9. Orders in `CUSTOMER_CONFIRMED`, `ACCEPTED`, or `PAYMENT_PENDING` currently reserve campaign-cap capacity indefinitely. Only stale `SUBMITTED` orders have the 24-hour expiry. A separate payment/progression deadline policy is required.
10. Customer token endpoints currently have no rate limiting. Add per-IP/token throttling before wider public exposure.


### Payment-pending rejection semantics
`PAYMENT_PENDING` is entered when ADMIN assigns logistics to an accepted order. At that point the backend creates/upserts the Payment record with the goods + delivery amount and `Payment.status=PENDING`. Buyer submission of a manual payment reference does **not** advance the Order out of `PAYMENT_PENDING`; it changes the Payment to `SUBMITTED` and stores the method/reference while waiting for ADMIN confirmation. ADMIN confirmation changes Payment to `CONFIRMED` and Order to `PAID`.

Therefore buyer rejection while Order is `PAYMENT_PENDING` has two branches. If Payment is still `PENDING` (no submitted proof), normal cancellation is allowed and the campaign slot is released. If Payment is `SUBMITTED`, the backend assumes money may already have left the buyer: it changes Order to `DISPUTED`, creates an OPEN Dispute, changes Payment to `REFUND_PENDING` for the full payment amount, and records `CUSTOMER_REJECTED_ORDER` with `refundRequired=true`. The disputed order continues to reserve its campaign slot until the exception is resolved.

### Expiry/cron verification
The 24-hour SUBMITTED expiry is covered in the real PostgreSQL integration suite, not with a mocked database or mocked clock. The test writes explicit `createdAt` ages (25 hours old and 23 hours old), invokes the expiry function with the real Prisma client, and verifies only the stale order is cancelled plus one `ORDER_EXPIRED` event.

`api/cron/expire-orders.js` accepts GET (and POST), requires exactly `Authorization: Bearer <CRON_SECRET>`, returns 401 for a missing or incorrect secret, and on success returns `{ "expired": <number>, "cutoff": "<ISO timestamp>" }`. Integration tests cover missing/wrong authorization and an authorized GET that expires a real stale database row. No Vercel cron schedule is committed yet.
