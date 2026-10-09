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


## Stage B1 — auth + role shell

### Implemented
- Replaced the prototype landing/auth shell with a mobile-first EARN interface using the specified palette, DM Sans, accessible touch sizes, real form controls, loading states and API error messages.
- Public landing copy: “Sell products. See exactly what you earn. Get paid when delivery is confirmed.”
- Sign-up and sign-in use the real `POST /api/auth/signup` and `POST /api/auth/login` endpoints. Both screens ask the user to choose Earner or Business. Sign-in verifies the server-returned role matches that choice rather than trusting the client.
- Session restoration uses the real `GET /api/me` endpoint.
- Earner shell exposes only Home, Sell, Orders and Money. Business shell exposes only Campaigns, Orders and Money. B1 tab bodies are explicit “Coming in the next stage” placeholders and contain no fake data.
- ADMIN is deliberately not admitted into either role shell. Admin tools remain a separate future `/admin` experience.
- Logout removes the session token and returns to the public landing page.
- Browser API calls live in `public/client.js`; user-facing copy lives in `public/strings.js`.

### Session-token handling
The JWT returned by the existing API is stored in browser `sessionStorage` under `earn_session_token`. Passwords are never stored. `sessionStorage` was chosen instead of `localStorage` so the token is scoped to the tab/session and is normally discarded when that browsing session ends. This is acceptable for the current B1 pilot but is not equivalent to an HttpOnly cookie: any successful same-origin XSS could read the token. Moving auth to Secure + HttpOnly + SameSite cookies would require a backend auth contract change and is therefore recorded as a backend hardening gap rather than silently changed in this frontend-only stage.

### B1 backend gaps
1. Authentication returns a bearer JWT to JavaScript rather than setting a Secure/HttpOnly/SameSite session cookie. Consider cookie-based sessions before higher-risk public deployment.
2. There is no dedicated admin web route/shell yet. B1 intentionally excludes ADMIN from earner/business navigation; Stage B7 owns the admin experience.
3. Existing customer token endpoints still lack rate limiting.
4. Orders in CUSTOMER_CONFIRMED / ACCEPTED / PAYMENT_PENDING still need progression/payment deadlines so campaign capacity cannot remain reserved indefinitely.

### B1 verification
The user confirmed `npm test` and `npm run test:integration` passed on main immediately before B1. B1 does not modify `api/`, `prisma/`, or backend logic in `lib/`. This environment could inspect and write GitHub files but could not execute the browser flow, npm tests, Prisma, or the private database. Before merging B1, run both existing test commands and manually verify Earner and Business signup/login/logout using the steps in PR #3.


## Stage B2 — Earner Home + Sell

### Implemented
- Earner Home now loads the real live campaign list, `GET /api/me/orders`, and `GET /api/me/earnings`.
- Money cards avoid a prominent zero state when the earner has no ledger activity. “Ready for payout” is the sum of the earner's PAYABLE order settlements; “On the way” is the remaining unpaid ledger balance. Withdraw is visibly disabled and explains that withdrawal requests are not built yet.
- “Sell and earn” shows only live ORDER + PER_UNIT campaigns so the UI can truthfully state “You earn Rs X per unit”. The amount is derived from the campaign's business commission per unit and earner share.
- “Your orders” uses real earner orders and plain-language status chips.
- Sell uses the real `POST /api/campaigns/:id/start` and `POST /api/orders` flow. Buyer name, Nepal phone, quantity stepper and live earnings preview are sent to the existing API.
- A UUID idempotency key is generated once when the user first submits an attempt and retained across a failed retry. Editing buyer fields or quantity starts a new attempt/key. A successful creation clears the key.
- The returned `customerConfirmationPath` is resolved against the current site origin. The UI can copy it or open WhatsApp with a prefilled buyer-confirmation message. No SMS is claimed or sent.
- SUBMITTED orders expose “Get buyer link again”. After an explicit warning/confirmation it calls `POST /api/orders/:id/reissue-confirmation`; the new link is shown and the UI warns that reissuing invalidates the old link.
- API errors are surfaced. Campaign-cap and duplicate-buyer errors are translated into plain customer-facing words; fetch/network failure has a specific retry message.

### B2 backend gaps
1. There is no withdrawal-request endpoint. Withdraw remains disabled; existing admin settlement reconciliation is the real payout path.
2. `GET /api/me/earnings` exposes the ledger balance but does not split “ready” versus “on the way”. B2 combines that ledger balance with the earner's PAYABLE settlements from `GET /api/me/orders`. A dedicated earner money summary endpoint would make this contract explicit.
3. Campaigns have a title but no separate customer-facing product-name field. B2 uses the campaign title as the product name when creating the order.
4. The campaign API supports commission structures that cannot honestly be described as a fixed “Rs X per unit”. B2 therefore lists only live ORDER + PER_UNIT campaigns in the primary selling UI.
5. Idempotent `POST /api/orders` retries intentionally cannot reproduce the original raw buyer token because only its hash is stored. If a successful response was lost, the UI directs the earner to Orders → “Get buyer link again”.
6. Clipboard access can be restricted by browser/security context. WhatsApp sharing remains available, and the link itself is visibly selectable.
7. Existing auth/session, customer-token rate-limit, and long-running order deadline gaps from B1 remain open.

### B2 verification
PR #3/B1 was locally checked by the user before its squash merge. B2 changes are frontend-only: `index.html`, `public/client.js`, `public/strings.js`, and this plan. No `api/`, `prisma/`, or backend `lib/` logic was changed.

This environment could inspect, compare, and write GitHub repository files, but it could not execute the browser flow, npm, Prisma, or the private database. No post-B2 runtime pass is claimed. Run the existing domain/integration suites and the manual B2 flow in the B2 PR before merge.


## Stage B3 — public buyer page

### Implemented
- `/confirm-order?token=...` is a public buyer experience. It does not require an EARN account; the existing high-entropy buyer token is the credential.
- SUBMITTED shows business, goods, quantity, unit price and goods total with “Yes, I placed this order” and “I did not place this order”.
- Confirmation uses the real customer-confirm endpoint. Rejection uses the real customer-reject endpoint.
- PAYMENT_PENDING shows goods, EARN delivery fee, total amount due, the required EARN payment trust copy, manual method/reference form, and the real customer-payment endpoint.
- If Payment is already SUBMITTED, the page explains that rejecting now opens refund review rather than silently cancelling. The API's DISPUTED response is shown as a refund-review state.
- DELIVERED asks for actual quantity received, defaults to ordered quantity, requires the six-digit delivery PIN, and calls the real delivery-verification endpoint. PARTIALLY_DELIVERED is explained without internal terminology.
- Other order states have plain status views. Invalid, expired, or replaced buyer tokens get a friendly message.
- Buyer pages do not render internal order IDs, phone hashes, token hashes, seller IDs, or other customers' data.

### B3 backend gaps
1. The buyer order response does not provide EARN bank/QR/payment-destination instructions. B3 therefore shows a conspicuous placeholder telling the buyer **not to send money until EARN provides verified payment details**. This must be replaced by a server-controlled payment-instructions contract before real manual payments.
2. The backend returns a delivery PIN only once, in the response to buyer confirmation, while the buyer order GET deliberately does not return it. B3 tells the buyer to retain/use that six-digit PIN. There is no secure PIN recovery endpoint if the buyer loses it.
3. The requested wording says money is “held safely”. The current backend records manual payment references and ADMIN confirmation but does not integrate a regulated escrow/payment provider. This wording describes the intended operating process, not a technical/legal escrow guarantee; payment/legal review remains required before production claims are finalized.
4. There is no explicit `EXPIRED` OrderStatus. The 24-hour expiry changes stale SUBMITTED orders to CANCELLED with an internal cancellation reason, but the public buyer GET does not expose that reason. B3 therefore cannot distinguish “expired” from other cancellations through the current API.
5. Customer-token endpoints still have no rate limiting.
6. Buyer order GET exposes payment status/method but intentionally not the submitted payment reference. B3 can show that proof was submitted without echoing sensitive reference data.
7. Admin operations required for the full buyer lifecycle (payment confirmation, logistics assignment, pickup/delivery) still have no UI; B7 remains the admin stage.

### Local-only B3 end-to-end setup
Use a local/dev database only. Never run these lifecycle commands against production merely to test UI. Obtain an ADMIN bearer token from a local ADMIN account and use the order ID created in the local Earner flow.

After the buyer confirms the order, the business must first accept it with its BUSINESS token:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/accept \
  -H "Authorization: Bearer BUSINESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quantity":1}'
```

Then ADMIN assigns logistics, which creates the payment amount and moves the order to PAYMENT_PENDING:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/assign-logistics \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transporterName":"Local test rider","transporterPhone":"9800000000","quotedFeeNpr":100,"transporterCostNpr":80}'
```
Save the returned `pickupCode` locally. Do not commit it.

Use the buyer page to submit a manual payment reference. ADMIN then confirms it:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/confirm-payment \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Business marks the paid order ready:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/ready \
  -H "Authorization: Bearer BUSINESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

ADMIN records pickup using the saved pickup code and the accepted quantity:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/pickup \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pickupCode":"PICKUP_CODE","quantity":1}'
```

Optionally mark it out for delivery, then delivered:
```bash
curl -X POST http://localhost:3000/api/orders/ORDER_ID/out-for-delivery \
  -H "Authorization: Bearer ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}'

curl -X POST http://localhost:3000/api/orders/ORDER_ID/delivered \
  -H "Authorization: Bearer ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}'
```

Finally reload the buyer link and submit the actual received quantity plus the six-digit delivery PIN returned when the buyer originally confirmed the order. Test both full quantity and, on a separate order, a smaller quantity.

### B3 verification
B2 was checked locally/preview by the user before squash merge. B3 is frontend-only: `index.html`, `public/client.js`, `public/strings.js`, and this plan. No `api/`, `prisma/`, or backend `lib/` logic changed. This environment could inspect/write/compare GitHub files but could not execute npm, Prisma, the private database, browser payment flow, or local curl lifecycle. No post-B3 runtime pass is claimed.


## Stage B4 — Earner + Business order tracker

### Implemented
- The Orders tab for both EARNER and BUSINESS now loads its real role-scoped order endpoint and opens a seven-step vertical tracker: Buyer confirmed → Business accepted → Buyer pays EARN → Pickup → Delivery → Buyer confirms quantity → You get paid.
- Completed steps are green, the current step is amber, and upcoming steps are neutral grey. Each step has one plain-language explanation.
- The reassurance copy is deliberately limited to the actual contract: the earner's commission becomes payable after delivery is confirmed and the order completes.
- Earner tracker shows expected commission from the immutable order reward snapshot when present, with the created Reward amount as a compatibility fallback.
- “Something wrong?” opens a reason + optional note form and calls the real `POST /api/orders/:id/dispute`. There is no photo control because attachment storage does not exist.
- Existing open disputes from the order list response are shown as “Under review” with the submitted reason/note.
- Business uses the same tracker but does not show the earner's commission amount.

### B4 backend gaps
1. There is no single order-detail/event-history GET endpoint. The seven-step tracker must infer progress from the current OrderStatus; it cannot show an immutable per-step timestamp/audit trail.
2. There is no admin dispute-resolution endpoint yet. A submitted dispute can be shown as OPEN/under review, but the UI cannot truthfully provide a resolution workflow until backend support exists.
3. `POST /api/orders/:id/dispute` currently permits creating another dispute even if one is already open. B4 displays the existing open dispute, but the backend should enforce the desired duplicate/open-dispute policy.
4. There is no dispute attachment/photo endpoint; B4 intentionally supports text only.
5. The current order-list response includes the immutable `earnerRewardPaisaSnapshot` directly on Order. B4 uses it for expected commission; older/legacy rows can fall back to Reward amount. A dedicated public order DTO would reduce exposure of unrelated internal fields.
6. The seven conceptual steps do not map one-to-one to every exception state (cancelled, returned, disputed, partial delivery). B4 leaves the order status visible and does not pretend an exception completed a normal milestone.

### B4 verification
B4 is frontend-only: `index.html`, `public/client.js`, `public/strings.js`, and this plan. It branches from main after the B3 squash merge and does not include the separate payment-instructions backend branch. This environment could inspect/write/compare GitHub files but could not execute npm, Prisma, the private database, or browser interaction. No post-B4 runtime pass is claimed.
