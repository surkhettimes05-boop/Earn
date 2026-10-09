# EARN — Zero-capital earning network

Interactive proof of concept for a two-sided outcome marketplace. Open `index.html` in a browser or deploy it as a static site.

## Included
- Earner opportunity marketplace for orders, leads, referrals, and content
- Business campaign creation with success rules, reward, and outcome cap
- Earner evidence submission with per-campaign duplicate-reference check
- Demo reviewer queue to approve or reject submissions
- Activity and approved reward totals
- Responsive mobile-first interface; localStorage persistence

## IMPORTANT: NOT PRODUCTION READY
This is a **local browser demo**, not a real marketplace. Sample businesses and campaigns are fictional. There is no login, server, database, identity/consent verification, payment processing, escrow, secure evidence storage, audit ledger, or permission enforcement. All users of the same browser can act as business, worker, and reviewer. Do not use for actual leads, personal information, real commissions, or public business campaigns.

## Production milestones
1. PostgreSQL/Prisma schema, migrations and server-side authenticated roles (earner, business, admin).
2. Verified business onboarding and moderated campaigns; explicit locked reward terms and capped funding obligations.
3. Consented lead capture, OTP confirmation, idempotent order references, anti-duplicate attribution.
4. Append-only verification events and financial ledger; disputes and reviewer separation.
5. Secure object storage for content, malware/size checks, signed uploads.
6. Verified fulfillment/conversion milestones, manual payout reconciliation, bank/e-wallet references.
7. Abuse/rate limiting, privacy policy, retention/deletion, Nepal-specific legal and payment review.
8. Automated tests for duplicate claims, reward caps, concurrent approvals, payout idempotency, role isolation.

## Deploy
Vercel: Import repository as **Other** framework, leave build command empty, set output directory to `.` (repository root). Static hosting only; demo data will remain browser-local.


## V2 transaction engine
The repository now includes a PostgreSQL/Prisma API for the first real ORDER lifecycle: authenticated EARNER/BUSINESS roles, live campaigns, deterministic attribution codes, idempotent order creation, merchant accept/deliver/cancel transitions, reward caps, and append-only reward ledger entries.

### Local setup
1. Copy `.env.example` to `.env` and set PostgreSQL `DATABASE_URL` plus a 32+ character `JWT_SECRET`.
2. Run `npm install`.
3. Run `npm run db:deploy && npm run db:seed`.
4. Run `npm test` then `npm run dev`.

The seed creates local demo credentials only. Do not deploy those credentials to a public production database. The existing browser UI is still a prototype and is **not yet wired to these APIs**. Production gaps still include OTP/customer confirmation, payout settlement, business KYC, rate limiting, dispute workflow, and secure lead/content evidence storage.
