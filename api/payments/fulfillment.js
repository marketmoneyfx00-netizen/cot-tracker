/**
 * api/payments/fulfillment.js — Production Final
 *
 * PRINCIPIOS:
 *   1. auth_user_id = única clave de identidad
 *   2. stripe_customer_id = clave de recovery (Customer tiene auth_user_id en metadata)
 *   3. stripe_subscription_id = clave de cancelación
 *   4. Email = dato informativo, NUNCA clave de decisión
 *   5. listUsers() PROHIBIDO — no escala, es un scan completo
 *
 * Recovery de auth_user_id (orden estricto, sin email):
 *   1. session/invoice metadata.auth_user_id
 *   2. users_access WHERE stripe_customer_id = customerId
 *   3. payments WHERE stripe_customer_id = customerId (pago previo)
 *   4. Stripe Customer metadata.auth_user_id (source of truth)
 *   → Si no se resuelve: error 500, Stripe reintenta
 *
 * Exports:
 *   fulfillFromCheckoutSession(session, stripe)
 *   fulfillFromInvoicePaid(invoice, stripe)
 *   handleSubscriptionCancelled(subscription)
 */

import { supabaseAdmin } from '../_lib/supabase/admin.js';
import { generateReceiptPDF, getStoragePath } from '../_lib/pdf/receipt.js';
import { sendWelcomeEmail } from '../_lib/email/resend.js';
import { PRICE_ID_TO_PLAN, PLAN_NAMES, PLAN_FALLBACK_DAYS } from '../_lib/stripePlans.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Helpers ────────────────────────────────────────────────────────────────────
function resolvePlan(...candidates) {
  for (const id of candidates) {
    if (id && PRICE_ID_TO_PLAN[id]) {
      console.log(`[fulfillment] plan: ${id} → ${PRICE_ID_TO_PLAN[id]}`);
      return PRICE_ID_TO_PLAN[id];
    }
  }
  console.warn('[fulfillment] WARN: no price_id match, defaulting to mensual. Tried:', candidates);
  return 'mensual';
}

function resolveValidUntil(periodEnd, planId) {
  if (periodEnd && typeof periodEnd === 'number') {
    const d = new Date(periodEnd * 1000);
    // Rechazar fechas en el pasado (reembolsos, ajustes de Stripe)
    if (d.getTime() > Date.now()) {
      console.log(`[fulfillment] valid_until from period_end: ${d.toISOString()}`);
      return d;
    }
    console.warn(`[fulfillment] WARN: period_end is in the past (${d.toISOString()}) — using plan fallback`);
  }
  const days = PLAN_FALLBACK_DAYS[planId] ?? 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  console.warn(`[fulfillment] WARN: period_end missing/past — ${days}d fallback: ${d.toISOString()}`);
  return d;
}

/**
 * Recupera auth_user_id de forma determinista.
 *
 * ORDEN ESTRICTO — sin email, sin listUsers:
 *   1. users_access WHERE stripe_customer_id = customerId
 *   2. payments WHERE stripe_customer_id = customerId (pago previo)
 *   3. Stripe Customer.metadata.auth_user_id (fuente primaria de verdad)
 *
 * Por qué Customer metadata es fiable:
 *   create-checkout-session.js siempre crea/busca el Customer y guarda
 *   auth_user_id en metadata ANTES de crear la sesión de pago.
 *   Eso lo convierte en la fuente de verdad más fiable.
 *
 * @param {string} customerId   - cus_xxx de Stripe
 * @param {object} stripe       - instancia de Stripe SDK
 * @returns {string|null}       - auth.users.id o null
 */
async function recoverAuthUserId(customerId, stripe) {
  if (!customerId) {
    console.error('[fulfillment] recoverAuthUserId: no customerId available');
    return null;
  }

  console.log(`[fulfillment] Recovering auth_user_id for customer: ${customerId}`);

  // ── Estrategia 1: users_access por stripe_customer_id ────────────────────
  {
    const { data, error } = await supabaseAdmin
      .from('users_access')
      .select('auth_user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (error) {
      console.warn(`[fulfillment] recover S1 error: ${error.message}`);
    } else if (data?.auth_user_id && UUID_RE.test(data.auth_user_id)) {
      console.log(`[fulfillment] Recovered via users_access.stripe_customer_id: ${data.auth_user_id}`);
      return data.auth_user_id;
    }
  }

  // ── Estrategia 2: payments por stripe_customer_id ─────────────────────────
  {
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('auth_user_id')
      .eq('stripe_customer_id', customerId)
      .not('auth_user_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`[fulfillment] recover S2 error: ${error.message}`);
    } else if (data?.auth_user_id && UUID_RE.test(data.auth_user_id)) {
      console.log(`[fulfillment] Recovered via payments.stripe_customer_id: ${data.auth_user_id}`);
      return data.auth_user_id;
    }
  }

  // ── Estrategia 3: Stripe Customer.metadata ────────────────────────────────
  // Esta es la fuente primaria de verdad: create-checkout-session siempre
  // guarda auth_user_id en metadata del Customer. Un lookup puntual por ID
  // es O(1) y no escanea nada.
  {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      const uid = customer?.metadata?.auth_user_id;
      if (uid && UUID_RE.test(uid)) {
        console.log(`[fulfillment] Recovered via Stripe Customer.metadata: ${uid}`);
        return uid;
      }
      console.warn(`[fulfillment] Customer.metadata.auth_user_id missing or invalid: ${uid}`);
    } catch (e) {
      console.error(`[fulfillment] recover S3 Stripe error: ${e.message}`);
    }
  }

  console.error(`[fulfillment] CRITICAL: auth_user_id unresolvable for customer=${customerId}`);
  return null;
}

// ── checkout.session.completed ─────────────────────────────────────────────────
export async function fulfillFromCheckoutSession(session, stripe) {
  const subscriptionId = session.subscription;
  const customerId     = session.customer ?? null;
  const sessionId      = session.id;
  const payerEmail     = (session.customer_details?.email ?? '').toLowerCase().trim();
  const payerName      = session.customer_details?.name ?? null;

  console.log(`[fulfillment] fulfillFromCheckoutSession | session=${sessionId} | sub=${subscriptionId} | customer=${customerId} | email=${payerEmail}`);

  if (!subscriptionId) {
    console.error('[fulfillment] ABORT: no subscription_id — is mode=subscription?');
    return { ok: false, error: 'no_subscription_id' };
  }
  if (!customerId) {
    console.error('[fulfillment] ABORT: no customer_id in session');
    return { ok: false, error: 'no_customer_id' };
  }
  // NOTE: email is informational only — NOT a blocker.
  // Apple Pay / Google Pay may not provide email at checkout time.
  // The fulfillment pipeline works correctly with payerEmail = '' or null.
  if (!payerEmail) {
    console.warn('[fulfillment] WARN: no customer email in session — proceeding without email');
  }

  // ── Resolver auth_user_id ─────────────────────────────────────────────────
  let authUserId = session.metadata?.auth_user_id ?? null;

  if (!authUserId || !UUID_RE.test(authUserId)) {
    console.warn(`[fulfillment] auth_user_id absent/invalid in session metadata — recovering`);
    authUserId = await recoverAuthUserId(customerId, stripe);
  } else {
    console.log(`[fulfillment] auth_user_id from metadata: ${authUserId}`);
  }

  if (!authUserId) {
    console.error('[fulfillment] CRITICAL: auth_user_id unresolvable — returning 500 for Stripe retry');
    return { ok: false, error: 'auth_user_id_unresolvable' };
  }

  // ── Recuperar invoice de Stripe ───────────────────────────────────────────
  let invoice = null;
  if (session.invoice) {
    try {
      invoice = await stripe.invoices.retrieve(session.invoice);
      console.log(`[fulfillment] Invoice: ${invoice.id} | paid=${invoice.amount_paid} | period_end=${invoice.lines?.data?.[0]?.period?.end}`);
    } catch (e) {
      console.warn('[fulfillment] WARN: invoice retrieve failed:', e.message);
    }
  } else {
    console.warn('[fulfillment] WARN: session.invoice is null');
  }

  const planId     = resolvePlan(session.metadata?.price_id, invoice?.lines?.data?.[0]?.price?.id);
  const amount     = (invoice?.amount_paid ?? session.amount_total ?? 0) / 100;
  const currency   = (invoice?.currency   ?? session.currency   ?? 'eur').toUpperCase();
  const periodEnd  = invoice?.lines?.data?.[0]?.period?.end ?? invoice?.period_end ?? null;
  const validUntil = resolveValidUntil(periodEnd, planId);
  const idempotencyKey = invoice?.id ?? subscriptionId;

  return _pipeline({
    idempotencyKey, subscriptionId, customerId, sessionId,
    payerEmail, payerName, authUserId,
    planId, productName: PLAN_NAMES[planId] ?? 'COT Tracker',
    amount, currency, validUntil, isRenewal: false,
    rawMetadata: { type: 'checkout', session_id: sessionId, subscription_id: subscriptionId, invoice_id: invoice?.id ?? null },
  });
}

// ── invoice.paid (renovaciones) ────────────────────────────────────────────────
export async function fulfillFromInvoicePaid(invoice, stripe) {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id ?? null;

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  const payerEmail = (invoice.customer_email ?? '').toLowerCase().trim();
  const payerName  = invoice.customer_name ?? null;
  const subMeta    = invoice.subscription_details?.metadata ?? null;

  console.log(`[fulfillment] fulfillFromInvoicePaid | invoice=${invoice.id} | sub=${subscriptionId} | customer=${customerId} | reason=${invoice.billing_reason}`);

  if (!subscriptionId) {
    console.warn('[fulfillment] invoice.paid without subscription — skipping');
    return { ok: true, skipped: true };
  }
  if (!customerId) {
    console.error('[fulfillment] ABORT: no customer_id in invoice:', invoice.id);
    return { ok: false, error: 'no_customer_id' };
  }
  // NOTE: email is informational only — NOT a blocker.
  if (!payerEmail) {
    console.warn('[fulfillment] WARN: no customer_email in invoice — proceeding without email');
  }

  // ── Resolver auth_user_id ─────────────────────────────────────────────────
  let authUserId = subMeta?.auth_user_id ?? null;

  if (!authUserId || !UUID_RE.test(authUserId)) {
    console.warn(`[fulfillment] auth_user_id absent/invalid in subscription metadata — recovering`);
    authUserId = await recoverAuthUserId(customerId, stripe);
  } else {
    console.log(`[fulfillment] auth_user_id from subscription metadata: ${authUserId}`);
  }

  if (!authUserId) {
    console.error('[fulfillment] CRITICAL: auth_user_id unresolvable for invoice:', invoice.id);
    return { ok: false, error: 'auth_user_id_unresolvable' };
  }

  const planId     = resolvePlan(subMeta?.price_id, invoice.lines?.data?.[0]?.price?.id);
  const amount     = (invoice.amount_paid ?? 0) / 100;
  const currency   = (invoice.currency   ?? 'eur').toUpperCase();
  const periodEnd  = invoice.lines?.data?.[0]?.period?.end ?? invoice.period_end ?? null;
  const validUntil = resolveValidUntil(periodEnd, planId);

  return _pipeline({
    idempotencyKey: invoice.id,
    subscriptionId, customerId, sessionId: null,
    payerEmail, payerName, authUserId,
    planId, productName: PLAN_NAMES[planId] ?? 'COT Tracker',
    amount, currency, validUntil,
    isRenewal: invoice.billing_reason !== 'subscription_create',
    rawMetadata: { type: 'invoice', invoice_id: invoice.id, subscription_id: subscriptionId, billing_reason: invoice.billing_reason },
  });
}

// ── customer.subscription.deleted ─────────────────────────────────────────────
export async function handleSubscriptionCancelled(subscription) {
  console.log(`[fulfillment] handleSubscriptionCancelled | sub=${subscription.id} | customer=${subscription.customer}`);

  if (!subscription.id) {
    console.error('[fulfillment] subscription.deleted: no subscription.id');
    return { ok: false, error: 'no_subscription_id' };
  }

  // Cancelación atómica por stripe_subscription_id via RPC.
  // Determinista, sin email, sin ambigüedad.
  const { data: updated, error } = await supabaseAdmin
    .rpc('cancel_user_access', { p_stripe_subscription_id: subscription.id });

  if (error) {
    console.error('[fulfillment] cancel_user_access RPC failed:', error.message);
    return { ok: false, error: error.message };
  }

  if (!updated) {
    // Fila no encontrada: puede que ya esté cancelada o que el acceso nunca se activó.
    // No es un error recuperable — Stripe ya canceló en su sistema.
    console.warn(`[fulfillment] cancel_user_access: no row for sub=${subscription.id} (may be already cancelled)`);
    return { ok: true, note: 'no_row_found' };
  }

  console.log(`[fulfillment] ✅ Cancelled: sub=${subscription.id}`);
  return { ok: true };
}

// ── charge.refunded ────────────────────────────────────────────────────────────
export async function handleChargeRefunded(charge) {
  // Only act on full refunds
  if ((charge.amount_refunded ?? 0) < charge.amount) {
    console.log(`[fulfillment] charge.refunded: partial refund (${charge.amount_refunded}/${charge.amount}) — no action`);
    return { ok: true, skipped: true };
  }

  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id ?? null;
  if (!customerId) {
    console.warn('[fulfillment] charge.refunded: no customer_id — skip');
    return { ok: true, skipped: true };
  }

  const { data, error } = await supabaseAdmin
    .from('users_access')
    .update({ status: 'cancelled', valid_until: new Date().toISOString() })
    .eq('stripe_customer_id', customerId)
    .eq('status', 'active')
    .select('auth_user_id');

  if (error) {
    console.error('[fulfillment] handleChargeRefunded DB error:', error.message);
    return { ok: false, error: error.message };
  }

  console.log(`[fulfillment] charge.refunded: revoked ${data?.length ?? 0} access(es) for customer=${customerId}`);
  return { ok: true };
}

// ── customer.subscription.updated ──────────────────────────────────────────────
export async function handleSubscriptionUpdated(subscription) {
  const status = subscription.status;

  if (status !== 'active' && status !== 'trialing') {
    console.log(`[fulfillment] subscription.updated: status=${status} — no action`);
    return { ok: true, skipped: true };
  }

  const subId      = subscription.id;
  const priceId    = subscription.items?.data?.[0]?.price?.id ?? null;
  const planId     = PRICE_ID_TO_PLAN[priceId] ?? null;
  const periodEnd  = subscription.current_period_end ?? null;

  if (!planId || !periodEnd) {
    console.warn(`[fulfillment] subscription.updated: unrecognized priceId=${priceId} or no periodEnd — skip`);
    return { ok: true, skipped: true };
  }

  const validUntil = new Date(periodEnd * 1000);

  const { error } = await supabaseAdmin
    .from('users_access')
    .update({ plan_id: planId, valid_until: validUntil.toISOString(), status: 'active' })
    .eq('stripe_subscription_id', subId);

  if (error) {
    console.error('[fulfillment] handleSubscriptionUpdated DB error:', error.message);
    return { ok: false, error: error.message };
  }

  console.log(`[fulfillment] subscription.updated: sub=${subId} → plan=${planId} valid_until=${validUntil.toISOString()}`);
  return { ok: true };
}

// ── PIPELINE INTERNO ───────────────────────────────────────────────────────────
async function _pipeline({
  idempotencyKey,
  subscriptionId,
  customerId,
  sessionId,
  payerEmail,
  payerName,
  authUserId,
  planId,
  productName,
  amount,
  currency,
  validUntil,
  isRenewal,
  rawMetadata,
}) {
  // ── Guards finales — todos los IDs críticos deben existir ──────────────────
  if (!authUserId || !UUID_RE.test(authUserId)) {
    console.error('[fulfillment] _pipeline: invalid auth_user_id — ABORT');
    return { ok: false, error: 'auth_user_id_missing_in_pipeline' };
  }
  if (!customerId) {
    console.error('[fulfillment] _pipeline: missing stripe_customer_id — ABORT');
    return { ok: false, error: 'customer_id_missing_in_pipeline' };
  }
  if (!subscriptionId) {
    // subscriptionId is required for activate_user_access and cancellation lookup.
    // An invoice without a subscription should never reach here (filtered upstream).
    console.error('[fulfillment] _pipeline: missing stripe_subscription_id — ABORT');
    return { ok: false, error: 'subscription_id_missing_in_pipeline' };
  }

  // ── [1/8] Idempotency ─────────────────────────────────────────────────────
  console.log(`[fulfillment] [1/8] idempotency key: ${idempotencyKey}`);
  const { data: existing, error: checkErr } = await supabaseAdmin
    .from('payments')
    .select('id, fulfilled_at, access_granted, auth_user_id')
    .eq('provider_transaction_id', idempotencyKey)
    .maybeSingle();

  if (checkErr) {
    console.error('[fulfillment] [1/8] FAILED:', checkErr.message);
    return { ok: false, error: `idempotency_check_failed: ${checkErr.message}` };
  }

  if (existing?.fulfilled_at && existing?.access_granted) {
    console.log(`[fulfillment] [1/8] Already fulfilled: ${idempotencyKey}`);
    return { ok: true, paymentId: existing.id, skipped: true };
  }

  // Consistencia: si el payment ya existe con otro auth_user_id → error duro
  if (existing?.auth_user_id && existing.auth_user_id !== authUserId) {
    console.error(`[fulfillment] [1/8] MISMATCH: existing auth_user_id=${existing.auth_user_id} !== resolved=${authUserId}`);
    return { ok: false, error: 'auth_user_id_mismatch_in_payments' };
  }

  // ── [2/8] Insert payment ──────────────────────────────────────────────────
  console.log(`[fulfillment] [2/8] Insert payment | auth:${authUserId} | cus:${customerId} | plan:${planId} | ${amount} ${currency}`);

  let paymentId;

  if (existing?.id) {
    paymentId = existing.id;
    console.log(`[fulfillment] [2/8] Reusing partial: ${paymentId}`);
  } else {
    const { data: ins, error: insErr } = await supabaseAdmin
      .from('payments')
      .insert({
        provider:                'stripe',
        provider_transaction_id: idempotencyKey,
        provider_order_id:       sessionId ?? subscriptionId,
        stripe_subscription_id:  subscriptionId,
        stripe_customer_id:      customerId,
        auth_user_id:            authUserId,
        payer_email:             payerEmail,
        payer_name:              payerName,
        amount,
        currency,
        product_name:            productName,
        product_type:            'subscription',
        plan_id:                 planId,
        status:                  'completed',
        paid_at:                 new Date().toISOString(),
        metadata:                rawMetadata,
      })
      .select('id')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        console.warn('[fulfillment] [2/8] Race 23505 — recovering existing row');
        const { data: r, error: rErr } = await supabaseAdmin
          .from('payments')
          .select('id, fulfilled_at, access_granted')
          .eq('provider_transaction_id', idempotencyKey)
          .single();
        if (rErr) return { ok: false, error: `race_recovery_failed: ${rErr.message}` };
        if (r?.fulfilled_at && r?.access_granted) return { ok: true, paymentId: r.id, skipped: true };
        if (r?.id) { paymentId = r.id; }
        else return { ok: false, error: 'race_condition_unrecoverable' };
      } else {
        console.error('[fulfillment] [2/8] Insert FAILED:', insErr.message, insErr.code, insErr.details, insErr.hint);
        return { ok: false, error: `payments_insert_failed: ${insErr.message}` };
      }
    } else {
      paymentId = ins.id;
      console.log(`[fulfillment] [2/8] ✅ payment inserted: ${paymentId}`);
    }
  }

  // ── [3/8] Activate access — CRITICAL (moved early: user gets access before PDF/email) ──
  console.log(`[fulfillment] [3/8] activate_user_access | auth:${authUserId} | cus:${customerId} | plan:${planId} | valid_until:${validUntil.toISOString()}`);

  const { error: accErr } = await supabaseAdmin.rpc('activate_user_access', {
    p_auth_user_id:           authUserId,
    p_stripe_customer_id:     customerId,
    p_stripe_subscription_id: subscriptionId,
    p_payer_email:            payerEmail,
    p_plan_id:                planId,
    p_payment_id:             paymentId,
    p_valid_until:            validUntil.toISOString(),
  });

  if (accErr) {
    console.error('[fulfillment] [3/8] CRITICAL activate_user_access FAILED:', accErr.message, accErr.code, accErr.details, accErr.hint);
    await supabaseAdmin.from('payments').update({ status: 'access_error' }).eq('id', paymentId);
    return { ok: false, paymentId, error: `access_activation_failed: ${accErr.message}` };
  }
  console.log(`[fulfillment] [3/8] ✅ users_access updated`);

  // ── [4/8] Invoice number ──────────────────────────────────────────────────
  console.log(`[fulfillment] [4/8] invoice number`);
  const { data: invNum, error: invNumErr } = await supabaseAdmin.rpc('next_invoice_number');
  if (invNumErr || !invNum) {
    console.error('[fulfillment] [4/8] FAILED (non-critical — access already granted):', invNumErr?.message);
  }
  const invoiceNumber = (invNum && !invNumErr)
    ? (typeof invNum === 'string' ? invNum : String(invNum))
    : null;
  if (invoiceNumber) console.log(`[fulfillment] [4/8] ✅ ${invoiceNumber}`);

  // ── [5/8] PDF ─────────────────────────────────────────────────────────────
  console.log(`[fulfillment] [5/8] PDF`);
  const paidAt = new Date();
  let pdfBytes = null;
  if (invoiceNumber) {
    try {
      pdfBytes = await generateReceiptPDF({
        invoiceNumber, transactionId: idempotencyKey,
        orderId: sessionId ?? subscriptionId,
        payerEmail, payerName, productName, planId,
        amount, currency, paidAt, issuedAt: paidAt,
      });
      console.log(`[fulfillment] [5/8] ✅ ${pdfBytes.byteLength} bytes`);
    } catch (e) {
      console.error('[fulfillment] [5/8] PDF failed (non-critical):', e.message);
    }
  } else {
    console.log(`[fulfillment] [5/8] skip (no invoice number)`);
  }

  // ── [6/8] Upload PDF ──────────────────────────────────────────────────────
  let receiptUrl = null;
  if (pdfBytes) {
    console.log(`[fulfillment] [6/8] uploading PDF`);
    const sp = getStoragePath(idempotencyKey, paidAt);
    const { error: upErr } = await supabaseAdmin.storage
      .from('receipts')
      .upload(sp, pdfBytes, { contentType: 'application/pdf', cacheControl: '3600', upsert: true });
    if (upErr) {
      console.error('[fulfillment] [6/8] upload failed (non-critical):', upErr.message);
    } else {
      const { data: su } = await supabaseAdmin.storage.from('receipts').createSignedUrl(sp, 60 * 60 * 24 * 365);
      receiptUrl = su?.signedUrl ?? null;
      console.log(`[fulfillment] [6/8] ✅ signed URL: ${!!receiptUrl}`);
    }
  } else {
    console.log(`[fulfillment] [6/8] skip (no PDF)`);
  }

  // ── [7/8] Insert invoice ──────────────────────────────────────────────────
  if (invoiceNumber) {
    console.log(`[fulfillment] [7/8] insert invoice`);
    const { data: invRow, error: invErr } = await supabaseAdmin
      .from('invoices')
      .insert({
        payment_id: paymentId, invoice_number: invoiceNumber,
        pdf_url: receiptUrl,
        storage_path: pdfBytes ? getStoragePath(idempotencyKey, paidAt) : null,
      })
      .select('id').single();

    if (invErr) {
      console.error('[fulfillment] [7/8] invoices insert FAILED (non-critical):', invErr.message, invErr.code);
    } else {
      console.log(`[fulfillment] [7/8] ✅ invoice: ${invRow.id}`);
      await supabaseAdmin.from('payments')
        .update({ receipt_url: receiptUrl, invoice_id: invRow.id })
        .eq('id', paymentId);
    }
  } else {
    console.log(`[fulfillment] [7/8] skip (no invoice number)`);
  }

  // ── [8/8] Email ───────────────────────────────────────────────────────────
  console.log(`[fulfillment] [8/8] email → ${payerEmail}`);
  let emailOk = false;
  try {
    const er = await sendWelcomeEmail({
      to: payerEmail, payerName, invoiceNumber,
      transactionId: idempotencyKey, productName, planId,
      amount, currency, paidAt, validUntil,
      receiptPdfBytes: pdfBytes ?? new Uint8Array(0),
    });
    emailOk = er.success;
    if (emailOk) console.log(`[fulfillment] [8/8] ✅ email: ${er.messageId}`);
    else         console.warn('[fulfillment] [8/8] email failed (non-critical):', er.error);
  } catch (e) {
    console.error('[fulfillment] [8/8] email error (non-critical):', e.message);
  }

  // ── Mark fulfilled ─────────────────────────────────────────────────────────
  await supabaseAdmin.from('payments').update({
    fulfilled_at: new Date().toISOString(),
    access_granted: true,
    email_sent: emailOk,
    status: 'completed',
    receipt_url: receiptUrl,
  }).eq('id', paymentId);

  console.log(`[fulfillment] ✅ DONE | ${isRenewal ? 'RENEWAL' : 'NEW'} | ${idempotencyKey} → ${invoiceNumber} | auth:${authUserId} | valid_until:${validUntil.toISOString()}`);
  return { ok: true, paymentId, skipped: false };
}
