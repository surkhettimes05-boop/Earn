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
7. There is no customer endpoint for “I did not place this order.” The UI will explain that this action is unavailable until a backend rejection/cancellation route is added.
8. Dispute photo upload/storage does not exist, so the dispute form supports reason + note only.
9. Business campaign API still supports FIXED_ORDER/PERCENT_GMV and non-ORDER campaign types. The new primary UI intentionally sends only ORDER + PER_UNIT.
10. Existing API contains two `POST /orders` handlers; the first shadows the second. This front-end rebuild will not silently change API semantics. It will use the reachable handler and flag this backend cleanup separately.

No fake successful payment, payout, SMS, photo upload or dispute-resolution behavior will be presented as real.
