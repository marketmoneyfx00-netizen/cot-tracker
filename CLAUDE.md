# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # Production build → dist/
npm run lint      # ESLint v9 (flat config)
npm run preview   # Preview production build locally
```

There are no automated tests. All validation is manual via the browser.

## Architecture Overview

**COT Tracker** is a trading analytics SPA for Commitment of Traders (COT) data analysis. It is built with React 19 + Vite and deployed on Vercel (frontend + serverless API). The backend is Supabase (Postgres + Auth + Storage). Payments are processed by Stripe.

### Frontend (`src/`)

The app is a single large SPA. Routing is implicit — the app conditionally renders based on auth state and user access status, not a router library.

**Entry point:** `main.jsx` wraps everything in `<AuthProvider>` → `<App>`.

**`App.jsx`** is the dominant file. It imports and orchestrates all business logic engines, holds the main UI layout, and handles all market data analysis. Before editing it, understand that it is intentionally monolithic.

**Auth context (`src/context/AuthProvider.jsx`):**
- Provides `user`, `session`, `profile`, `accessStatus`, `loading` via `useAuth()`
- `onAuthStateChange` is registered once and never recreated
- `loadProfile()` is called with `setTimeout(0)` to avoid a Supabase internal lock deadlock — do not remove this delay
- Uses refs to avoid stale closures

**Access guard (`src/lib/accessGuard.js`):**
- `loadUserProfile(authUid)` reads `users_access` with retry logic for post-payment DB lag
- `getAccessStatus(profile)` returns `active | trial | inactive | expired`
- Access check happens at the context level; components read `accessStatus` via `useAuth()`

**Business logic engines** (all in `src/`):
- `cotBiasEngine.js` — COT bias score (-100 to +100) from CFTC positions
- `compositeScoreEngine.js` — Weighted composite of all signals
- `intradayExecutionEngine.js` — Intraday execution score
- `marketLogic.js` — Market indicator calculations
- `parseTiffCombined.js` — Parses CFTC TIFF/CSV files (two formats: TFF and legacy)

**Price data:** `src/services/priceService.js` polls `/api/price` on an interval. State stored in `src/hooks/usePriceStore.js`.

### Serverless API (`api/`)

All functions run as Vercel serverless Node.js functions. The service-role Supabase client lives in `api/_lib/supabase/admin.js` — never use the anon client server-side.

**Payments pipeline (`api/payments/`):**
- `create-checkout-session.js` — Creates or reuses a Stripe Customer, creates a Checkout Session
- `webhook.js` — Handles `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- `fulfillment.js` — 10-step idempotent fulfillment: insert payment → generate PDF → upload to Storage → activate user → send email. The `provider_transaction_id` field enforces idempotency.

**Price proxy (`api/price.js`):** Tries Finnhub first, falls back to TwelveData. Has an 8-second server-side cache per symbol. API keys never reach the client.

**Macro signals (`api/macro/`):** Fetches yields from FRED, builds spread calculations, returns macro bias signals.

### Database (Supabase)

Schema is in `supabase-migrations.sql`. Key tables:

| Table | Purpose |
|---|---|
| `users_access` | Subscription status, plan, `valid_until`, onboarding state |
| `payments` | Payment records; `status` transitions pending → completed |
| `invoices` | PDF receipt metadata and signed URL |
| `fulfillment_logs` | Append-only audit trail for each fulfillment step |

RLS: authenticated users can read only their own rows (matched by email). Service-role key bypasses RLS — only use it server-side.

**Key Postgres functions:**
- `next_invoice_number()` — Returns formatted `INV-YYYY-XXXXXX` using a sequence
- `activate_user_access(email, plan_id, payment_id, valid_until)` — Upserts `users_access`

**Storage:** `receipts` bucket (private). Path: `receipts/YYYY/MM/receipt_<tx_id>.pdf`. Access via 1-year signed URLs.

### Auth Flow

1. User enters email → `loginWithEmail()` sends Supabase magic link to `https://app.cot-tracker.com/auth/callback`
2. `src/pages/AuthCallback.jsx` detects the session hash and calls `supabase.auth.getSession()`
3. `onAuthStateChange('SIGNED_IN')` fires in AuthProvider → `loadUserProfile()` runs
4. Profile loaded from `users_access`; `accessStatus` determines what the user sees

Password login via `loginWithPassword()` skips the callback step.

### COT Data Flow

Users upload CFTC-published TIFF/CSV files manually. `parseTiffCombined.js` detects format and extracts futures positions for FX pairs. The engines score the data and the results render in the main dashboard.

## Environment Variables

See `env.example` for the full list with notes. Critical groupings:

- **Supabase:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (client); `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server)
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; price IDs are hardcoded in `api/payments/create-checkout-session.js`
- **Email:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_EMAIL`
- **Price APIs:** `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY` (server-side only)
- **Macro:** `FRED_API_KEY`, `RAPIDAPI_KEY`
- **App:** `APP_URL=https://app.cot-tracker.com`, `FRONTEND_ORIGIN` (used in CORS and redirect URLs)

`VITE_`-prefixed vars are bundled into the client. All others are Vercel server-only.

## Deployment

Deployed on Vercel. `vercel.json` handles:
- SPA routing rewrites (all paths → `index.html`, except `/api/*` and `/auth/callback`)
- CSP headers allowing Supabase, Stripe, Finnhub, TwelveData, Google Maps

To deploy: push to `master` (auto-deploy via Vercel Git integration) or run `vercel --prod`.

Stripe webhook endpoint must be registered at `https://app.cot-tracker.com/api/payments/webhook` in the Stripe dashboard.
