-- ================================================================
-- COT Tracker — Supabase Schema & Functions
-- Run this in Supabase SQL Editor (once, idempotent)
-- ================================================================

-- ── payments table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                text        NOT NULL DEFAULT 'paypal',
  provider_transaction_id text        NOT NULL UNIQUE,   -- idempotency key
  provider_order_id       text,
  payer_email             text        NOT NULL,
  payer_name              text,
  amount                  numeric     NOT NULL,
  currency                text        NOT NULL DEFAULT 'EUR',
  product_name            text,
  product_type            text        NOT NULL DEFAULT 'subscription',
  plan_id                 text,
  status                  text        NOT NULL DEFAULT 'pending',
  receipt_url             text,
  invoice_id              uuid,
  fulfilled_at            timestamptz,
  access_granted          boolean     NOT NULL DEFAULT false,
  email_sent              boolean     NOT NULL DEFAULT false,
  refunded_at             timestamptz,
  paid_at                 timestamptz,
  metadata                jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_transaction_id
  ON payments(provider_transaction_id);

CREATE INDEX IF NOT EXISTS idx_payments_payer_email
  ON payments(payer_email);

CREATE INDEX IF NOT EXISTS idx_payments_status
  ON payments(status);

-- ── invoices table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid REFERENCES payments(id) ON DELETE CASCADE,
  invoice_number text    NOT NULL UNIQUE,
  pdf_url        text,
  storage_path   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_payment_id
  ON invoices(payment_id);

-- ── fulfillment_logs table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  status     text        NOT NULL DEFAULT 'ok',
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_logs_payment_id
  ON fulfillment_logs(payment_id);

-- ── users_access table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  status      text        NOT NULL DEFAULT 'inactive',  -- inactive | trial | active | expired
  plan_id     text,
  payment_id  uuid REFERENCES payments(id),
  valid_until timestamptz,
  granted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_access_email
  ON users_access(email);

-- ── Invoice number sequence ───────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;

-- Returns formatted invoice number like INV-2025-001001
CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  seq_val bigint;
BEGIN
  seq_val := nextval('invoice_seq');
  RETURN 'INV-' || to_char(NOW(), 'YYYY') || '-' || lpad(seq_val::text, 6, '0');
END;
$$;

-- ── activate_user_access function ────────────────────────────────
-- Upserts the users_access row by payer email.
-- Creates user in auth.users if not already present (optional — depends on your auth setup).
CREATE OR REPLACE FUNCTION activate_user_access(
  p_payer_email  text,
  p_plan_id      text,
  p_payment_id   uuid,
  p_valid_until  timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO users_access (email, status, plan_id, payment_id, valid_until, granted_at)
  VALUES (p_payer_email, 'active', p_plan_id, p_payment_id, p_valid_until, NOW())
  ON CONFLICT (email) DO UPDATE
    SET status      = 'active',
        plan_id     = EXCLUDED.plan_id,
        payment_id  = EXCLUDED.payment_id,
        valid_until = EXCLUDED.valid_until,
        granted_at  = NOW(),
        updated_at  = NOW();
END;
$$;

-- ── Storage bucket ────────────────────────────────────────────────
-- Run this once in Supabase Storage UI or via API:
-- Create bucket named "receipts" with private access.
-- 
-- SQL equivalent (requires pg_storage extension):
-- SELECT storage.create_bucket('receipts', '{"public": false}'::jsonb);

-- ── Row Level Security (RLS) ──────────────────────────────────────
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_access     ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by api/ functions)
-- No additional policies needed for service role — it bypasses RLS by default.

-- Allow authenticated users to read their own payment + access data
CREATE POLICY IF NOT EXISTS "users_read_own_payments"
  ON payments FOR SELECT
  USING (auth.jwt() ->> 'email' = payer_email);

CREATE POLICY IF NOT EXISTS "users_read_own_access"
  ON users_access FOR SELECT
  USING (auth.jwt() ->> 'email' = email);

