# Folder Structure — COT Tracker Payment System

```
cot-tracker/
├── migrations/
│   ├── 001_payments.sql          # payments table + RLS
│   ├── 002_fulfillment_logs.sql  # append-only audit log
│   ├── 003_invoices_storage.sql  # invoices + invoice_number_seq + storage bucket
│   └── 004_access_grants.sql     # access_grants + activate_user_access() function
│
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   └── paypal/
│   │   │   │       └── route.ts       # PayPal webhook — verify + route events
│   │   │   └── admin/
│   │   │       └── fulfillment-logs/
│   │   │           └── route.ts       # Admin API — logs for a payment
│   │   └── admin/
│   │       └── payments/
│   │           └── page.tsx           # Admin panel — server component
│   │
│   ├── components/
│   │   └── admin/
│   │       └── PaymentsTable.tsx      # Interactive table — client component
│   │
│   └── lib/
│       ├── supabase/
│       │   └── admin.ts               # Service-role client + typed helpers
│       ├── paypal/
│       │   ├── verify.ts              # Webhook signature + OAuth token + plan utils
│       │   └── fulfillment.ts         # Idempotent 10-step fulfillment pipeline
│       ├── pdf/
│       │   └── receipt.ts             # PDF generation with pdf-lib
│       └── email/
│           └── resend.ts              # Welcome email with PDF attachment
│
├── public/
│   └── pricing.html                   # Static pricing page (already built)
│
├── .env.example                       # All required env vars + sandbox guide
└── docs/
    ├── folder-structure.md            # This file
    └── security-checklist.md          # Pre-launch + recovery procedures
```

## Data flow

```
PayPal Checkout
      │
      ▼
/api/webhooks/paypal (route.ts)
  1. verifyPayPalWebhook()     ← rejects fakes
  2. JSON.parse(rawBody)
  3. return 200 immediately    ← PayPal happy
  4. setImmediate → fulfillPayment()
         │
         ▼
  fulfillment.ts (idempotent)
    Step 1: idempotency check
    Step 2: INSERT payments
    Step 3: next_invoice_number() RPC
    Step 4: generateReceiptPDF()
    Step 5: supabase.storage.upload()
    Step 6: createSignedUrl() + UPDATE payments
    Step 7: activate_user_access() RPC → UPDATE users_access
    Step 8: sendWelcomeEmail()
    Step 9: UPDATE payments SET fulfilled_at, access_granted
    Step 10: appendLog('fulfillment_complete')
```

## npm packages required

```bash
npm install pdf-lib resend @supabase/supabase-js @supabase/auth-helpers-nextjs
```
