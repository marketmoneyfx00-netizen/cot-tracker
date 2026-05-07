-- ================================================================
-- COT Tracker — Supabase Schema & Functions (sincronizado 2026-05)
-- Refleja el esquema real desplegado en ijuysabdwobmhdmhxrnz
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ================================================================

-- ── Extensiones necesarias ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users_access ─────────────────────────────────────────────────
-- Una fila por usuario autenticado. Creada por trigger handle_new_user
-- o por la RPC ensure_user_access desde AuthCallback.
CREATE TABLE IF NOT EXISTS users_access (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id          uuid        UNIQUE REFERENCES auth.users(id),
  user_id               uuid        UNIQUE REFERENCES auth.users(id),
  email                 text        UNIQUE,
  nombre                text,
  plan                  text        DEFAULT 'free',
  status                text        DEFAULT 'active',
  access_type           text        DEFAULT 'trial',
  stripe_customer_id    text        UNIQUE,
  stripe_subscription_id text       UNIQUE,
  expires_at            timestamptz,
  onboarding_completed  boolean     DEFAULT false,
  first_login_at        timestamptz,
  market_selected       text,
  telegram_username     text,
  joined_telegram       boolean     DEFAULT false,
  trading_level         text,
  trading_goal          text,
  password_created      boolean     NOT NULL DEFAULT false,
  last_login            timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_access_auth_user_id ON users_access(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_access_email        ON users_access(email);
CREATE INDEX IF NOT EXISTS idx_users_access_stripe_cus   ON users_access(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_access_stripe_sub   ON users_access(stripe_subscription_id);

-- ── invoices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid,       -- FK añadido después de payments
  invoice_number text        NOT NULL UNIQUE,
  pdf_url        text,
  storage_path   text,
  metadata       jsonb       DEFAULT '{}',
  issued_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices(payment_id);

-- ── payments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        REFERENCES auth.users(id),
  auth_user_id            uuid,       -- FK lógico a auth.users (sin FK constraint para flexibilidad)
  provider                text        NOT NULL CHECK (provider IN ('paypal', 'stripe')),
  provider_transaction_id text        NOT NULL UNIQUE,
  provider_order_id       text,
  stripe_subscription_id  text,
  stripe_customer_id      text,
  payer_email             text        DEFAULT '',
  payer_name              text,
  amount                  numeric     NOT NULL CHECK (amount > 0),
  currency                text        NOT NULL DEFAULT 'EUR',
  product_name            text        NOT NULL,
  product_type            text        NOT NULL DEFAULT 'subscription',
  plan_id                 text,
  status                  text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','completed','denied','refunded','disputed','cancelled','access_error')),
  receipt_url             text,
  invoice_id              uuid        REFERENCES invoices(id),
  fulfilled_at            timestamptz,
  access_granted          boolean     NOT NULL DEFAULT false,
  email_sent              boolean     NOT NULL DEFAULT false,
  refunded_at             timestamptz,
  paid_at                 timestamptz,
  metadata                jsonb       DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_auth_user_id   ON payments(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_cus      ON payments(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status          ON payments(status);

-- FK de invoices → payments (después de crear ambas tablas)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_payment_id_fkey'
  ) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES payments(id);
  END IF;
END $$;

-- ── fulfillment_logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid        NOT NULL REFERENCES payments(id),
  action     text        NOT NULL,
  status     text        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','skipped')),
  details    jsonb       DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_logs_payment_id ON fulfillment_logs(payment_id);

-- ── login_logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_logs (
  id         bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id    uuid        REFERENCES auth.users(id),
  ip         text,
  device     text,
  success    boolean     DEFAULT true,
  fail_reason text,
  login_time timestamptz DEFAULT now()
);

-- ── subscriptions (legacy — no activamente usada) ─────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id           bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id      uuid        REFERENCES auth.users(id),
  tier         text        DEFAULT 'free',
  status       text        DEFAULT 'active',
  start_date   timestamptz DEFAULT now(),
  renewal_date timestamptz
);

-- ── waitlist_leads ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist_leads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  market          text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  utm_source      text,
  utm_campaign    text,
  utm_medium      text,
  landing_variant text,
  invite_sent_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── bug_reports ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bug_reports (
  id          bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_email  text,
  subject     text,
  description text        NOT NULL,
  device      text,
  status      text        DEFAULT 'open',
  created_at  timestamptz DEFAULT now()
);

-- ── Invoice number sequence ───────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;

-- ── FUNCIONES ─────────────────────────────────────────────────────

-- next_invoice_number: genera INV-YYYY-XXXXXX
CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  seq_val bigint;
BEGIN
  seq_val := nextval('invoice_seq');
  RETURN 'INV-' || to_char(NOW(), 'YYYY') || '-' || lpad(seq_val::text, 6, '0');
END;
$$;

-- ensure_user_access: crea fila en users_access si no existe (usada por AuthCallback)
CREATE OR REPLACE FUNCTION ensure_user_access(p_auth_user_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.users_access (auth_user_id, email, plan, status)
  VALUES (p_auth_user_id, p_email, 'free', 'active')
  ON CONFLICT (auth_user_id) DO NOTHING;
END;
$$;

-- activate_user_access: activa acceso tras pago (usada por fulfillment.js)
CREATE OR REPLACE FUNCTION activate_user_access(
  p_auth_user_id           uuid,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_payer_email            text    DEFAULT '',
  p_plan_id                text    DEFAULT 'mensual',
  p_payment_id             uuid    DEFAULT NULL,
  p_valid_until            timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  v_expires_at := COALESCE(p_valid_until, NOW() + INTERVAL '30 days');

  INSERT INTO users_access (
    auth_user_id, email, plan, status,
    stripe_customer_id, stripe_subscription_id,
    access_type, expires_at, granted_at,
    payment_id, onboarding_completed, updated_at
  )
  VALUES (
    p_auth_user_id, LOWER(TRIM(p_payer_email)), p_plan_id, 'active',
    p_stripe_customer_id, p_stripe_subscription_id,
    p_plan_id, v_expires_at, NOW(),
    p_payment_id, false, NOW()
  )
  ON CONFLICT (auth_user_id) DO UPDATE
    SET plan                   = EXCLUDED.plan,
        status                 = 'active',
        stripe_customer_id     = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        access_type            = EXCLUDED.access_type,
        expires_at             = EXCLUDED.expires_at,
        granted_at             = NOW(),
        payment_id             = COALESCE(EXCLUDED.payment_id, users_access.payment_id),
        updated_at             = NOW();

  -- También actualizar filas huérfanas (email coincide pero sin auth_user_id)
  IF p_payer_email IS NOT NULL AND TRIM(p_payer_email) != '' THEN
    UPDATE users_access
    SET auth_user_id           = p_auth_user_id,
        plan                   = p_plan_id,
        status                 = 'active',
        stripe_customer_id     = p_stripe_customer_id,
        stripe_subscription_id = p_stripe_subscription_id,
        access_type            = p_plan_id,
        expires_at             = v_expires_at,
        granted_at             = NOW(),
        updated_at             = NOW()
    WHERE email = LOWER(TRIM(p_payer_email))
      AND auth_user_id IS NULL;
  END IF;
END;
$$;

-- cancel_user_access: cancela acceso por subscription_id (usada por webhook)
CREATE OR REPLACE FUNCTION cancel_user_access(p_stripe_subscription_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE users_access
  SET status     = 'cancelled',
      updated_at = NOW()
  WHERE stripe_subscription_id = p_stripe_subscription_id
    AND status != 'cancelled';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- handle_new_user: trigger que crea fila en users_access al registrarse
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.users_access (
    auth_user_id, email, plan, status, access_type, onboarding_completed, created_at
  )
  VALUES (
    NEW.id, NEW.email, 'free', 'active', 'magic_link', false, now()
  )
  ON CONFLICT (email) DO UPDATE
  SET auth_user_id = EXCLUDED.auth_user_id,
      plan         = 'free',
      status       = 'active',
      updated_at   = now();

  RETURN NEW;
END;
$$;

-- Trigger: disparar handle_new_user al crear usuario en auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_access     ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_leads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports      ENABLE ROW LEVEL SECURITY;

-- users_access: cada usuario ve y edita solo su fila
CREATE POLICY IF NOT EXISTS "users_read_own_access"
  ON users_access FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "users_update_own_access"
  ON users_access FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "users_insert_own_access"
  ON users_access FOR INSERT
  WITH CHECK (true);

-- payments: usuario ve sus propios pagos
CREATE POLICY IF NOT EXISTS "users_read_own_payments"
  ON payments FOR SELECT
  USING (auth_user_id = auth.uid());

-- Service role bypasses RLS (no se necesitan políticas adicionales)

-- invoices: usuario ve sus propias facturas via payments
CREATE POLICY IF NOT EXISTS "users_read_own_invoices"
  ON invoices FOR SELECT
  USING (payment_id IN (
    SELECT id FROM payments WHERE auth_user_id = auth.uid()
  ));

-- login_logs: usuario puede insertar sus propios eventos
CREATE POLICY IF NOT EXISTS "users_insert_own_login_logs"
  ON login_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- waitlist_leads: inserción pública anónima con validación básica
CREATE POLICY IF NOT EXISTS "public_insert_waitlist"
  ON waitlist_leads FOR INSERT
  WITH CHECK (
    name IS NOT NULL AND length(trim(name)) >= 2
    AND email IS NOT NULL AND position('@' IN email) > 1
    AND market IS NOT NULL
  );

-- bug_reports: usuarios autenticados pueden insertar y ver los suyos
CREATE POLICY IF NOT EXISTS "users_insert_bug_reports"
  ON bug_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY IF NOT EXISTS "users_read_own_bug_reports"
  ON bug_reports FOR SELECT
  USING (user_email = (auth.jwt() ->> 'email'));

-- ── Storage bucket "receipts" ─────────────────────────────────────
-- Crear en Supabase Dashboard → Storage → New bucket
-- Nombre: "receipts", Acceso: Private
-- O via SQL (requiere extensión pg_storage):
-- SELECT storage.create_bucket('receipts', '{"public": false}'::jsonb);
