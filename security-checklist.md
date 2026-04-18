# Security & Deployment Checklist — COT Tracker Payments
# ============================================================

## BEFORE GOING LIVE

### Secrets
- [ ] SUPABASE_SERVICE_ROLE_KEY set in Vercel (not in .env committed to git)
- [ ] PAYPAL_CLIENT_SECRET set in Vercel
- [ ] RESEND_API_KEY set in Vercel
- [ ] No secrets in source code or git history
- [ ] .env.local is in .gitignore

### PayPal Webhook
- [ ] PAYPAL_WEBHOOK_ID matches the production webhook ID (NOT sandbox)
- [ ] Webhook subscribed to all 4 required events
- [ ] Signature verification is ON (verifyPayPalWebhook returns false rejects with 401)
- [ ] Webhook URL is HTTPS only

### Supabase
- [ ] RLS enabled on payments, fulfillment_logs, invoices, access_grants
- [ ] service_role policies are the ONLY write path
- [ ] Storage bucket 'receipts' is private (public=false)
- [ ] admin_read policy checks is_admin=true in JWT
- [ ] No anon reads on payments tables

### Admin Panel
- [ ] /admin/payments redirects to /login if not authenticated
- [ ] Admin flag set via Supabase Auth → Users → edit → user_metadata: { "is_admin": true }
- [ ] Admin route is NOT accessible to regular users

---

## SECURITY PROPERTIES

### Idempotency
Every step in fulfillment.ts is safe to repeat:
- Payment insert uses UNIQUE constraint on provider_transaction_id
- PDF upload uses upsert:true
- access_grants insert is additive
- Email: if duplicate webhook fires, email_sent=true check prevents re-send
  (add this check in fulfillment.ts step 8 if needed)

### Dispute Defense
Every payment stores:
- Raw PayPal webhook payload in metadata JSONB
- Fulfillment log with timestamps for every action
- PDF receipt with transaction ID, invoice number, payer email
- storage_path to retrieve original PDF even if signed URL expires

For a PayPal dispute:
1. Go to /admin/payments → search by payer email or TX ID
2. Click "Logs" → see full fulfillment timeline
3. Click "PDF" → download original receipt
4. In metadata JSONB → find raw PayPal capture data

### PDF Receipts
- Stored in Supabase Storage with 1-year signed URLs
- Signed URLs can be regenerated at any time from storage_path column
- Path pattern: receipts/YYYY/MM/receipt_<tx_id>.pdf

---

## RECOVERY PROCEDURES

### Re-run fulfillment for a failed payment
```sql
-- Find the payment
SELECT id, status, fulfilled_at, access_granted
FROM payments
WHERE provider_transaction_id = 'TX_ID_HERE';

-- Check what failed
SELECT action, status, details, created_at
FROM fulfillment_logs
WHERE payment_id = 'PAYMENT_ID_HERE'
ORDER BY created_at;
```

Then call fulfillPayment() again — it's idempotent and will
skip already-completed steps.

### Re-generate a signed URL for a receipt
```typescript
const { data } = await supabaseAdmin.storage
  .from('receipts')
  .createSignedUrl(payment.storage_path, 60 * 60 * 24 * 365);
```

### Manually grant access
```sql
SELECT public.activate_user_access(
  'user@email.com',
  'mensual',
  'PAYMENT_UUID'::uuid,
  now() + interval '30 days'
);
```

---

## MONITORING

### Vercel logs to watch
- `[webhook/paypal] Event: PAYMENT.CAPTURE.COMPLETED`
- `[fulfillment] ✅ Complete:`
- `[fulfillment] Fulfillment failed:` ← alert on this

### Supabase queries for health check
```sql
-- Payments without fulfillment in last 24h
SELECT id, payer_email, amount, created_at
FROM payments
WHERE status = 'completed'
  AND fulfilled_at IS NULL
  AND created_at > now() - interval '24 hours';

-- Error logs in last 24h
SELECT payment_id, action, details, created_at
FROM fulfillment_logs
WHERE status = 'error'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```
