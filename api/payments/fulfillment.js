/**
 * api/Payments/fulfillment.js
 *
 * Idempotent fulfillment pipeline.
 * Called once per PAYMENT.CAPTURE.COMPLETED event.
 *
 * Steps:
 *  1.  Idempotency check (skip if already processed)
 *  2.  Insert payment record
 *  3.  Generate invoice number
 *  4.  Generate PDF receipt
 *  5.  Upload PDF to Supabase Storage
 *  6.  Generate signed URL + save receipt_url to payment
 *  7.  Insert invoice record
 *  8.  Activate user access (DB function)
 *  9.  Send welcome email with receipt
 * 10.  Mark fulfilled_at + access_granted
 * 11.  Final fulfillment log
 */

import { supabaseAdmin, appendLog } from '../_lib/supabase/admin.js';
import { generateReceiptPDF, getStoragePath } from '../_lib/pdf/receipt.js';
import { sendWelcomeEmail } from '../_lib/email/resend.js';
import { getValidUntil, resolvePlanId } from './verify.js';

export async function fulfillPayment(input) {
  // ── Guard: validate input ─────────────────────────────────
  if (!input || !input.capture || !input.capture.id) {
    console.error('[fulfillment] Invalid input');
    return { ok: false, paymentId: null, skipped: false, error: 'invalid_input' };
  }

  const txId       = input.capture.id;
  const payerEmail = (input.payer?.email_address ?? '').toLowerCase().trim();

  if (!payerEmail) {
    console.error('[fulfillment] Missing payer email');
    return { ok: false, paymentId: null, skipped: false, error: 'missing_email' };
  }

  const payerName = [
    input.payer?.name?.given_name,
    input.payer?.name?.surname,
  ].filter(Boolean).join(' ') || null;

  const amount = parseFloat(input.capture.amount?.value || 0);

  if (!amount || isNaN(amount)) {
    console.error('[fulfillment] Invalid amount');
    return { ok: false, paymentId: null, skipped: false, error: 'invalid_amount' };
  }

  const currency    = input.capture.amount.currency_code;
  const planId      = resolvePlanId(input.capture.custom_id, undefined);

  const PLAN_NAMES = {
    mensual:    'COT Tracker Beta — Plan Mensual',
    trimestral: 'COT Tracker Beta — Plan Trimestral',
    semestral:  'COT Tracker Beta — Plan Semestral',
    anual:      'COT Tracker Beta — Plan Anual',
  };
  const productName = PLAN_NAMES[planId] ?? 'COT Tracker Beta';

  // ── Step 1: Idempotency check ─────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from('payments')
    .select('id, fulfilled_at, access_granted')
    .eq('provider_transaction_id', txId)
    .maybeSingle();

  if (existing?.fulfilled_at && existing?.access_granted) {
    console.log(`[fulfillment] Already fulfilled: ${txId}`);
    await appendLog({
      payment_id: existing.id,
      action:     'idempotency_check_passed',
      status:     'skipped',
      details:    { tx_id: txId, reason: 'already_fulfilled' },
    });
    return { ok: true, paymentId: existing.id, skipped: true };
  }

  // ── Step 2: Insert (or retrieve existing) payment row ────
  let paymentId;

  if (existing?.id) {
    paymentId = existing.id;
  } else {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('payments')
      .insert({
        provider:                'paypal',
        provider_transaction_id: txId,
        provider_order_id:       input.orderId,
        payer_email:             payerEmail,
        payer_name:              payerName,
        amount,
        currency,
        product_name:            productName,
        product_type:            'subscription',
        plan_id:                 planId,
        status:                  'completed',
        paid_at:                 new Date().toISOString(),
        metadata:                input.rawEvent,
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      console.error('[fulfillment] Insert payment failed:', insertErr?.message);
      return { ok: false, paymentId: null, skipped: false, error: insertErr?.message };
    }

    paymentId = inserted.id;
  }

  await appendLog({
    payment_id: paymentId,
    action:     'payment_received',
    status:     'ok',
    details:    { tx_id: txId, amount, currency, plan_id: planId },
  });

  // ── Step 3: Generate invoice number ──────────────────────
  const { data: invNumRow, error: invNumErr } = await supabaseAdmin
    .rpc('next_invoice_number');

  if (invNumErr || !invNumRow) {
    await appendLog({
      payment_id: paymentId,
      action:     'invoice_number_generated',
      status:     'error',
      details:    { error: invNumErr?.message },
    });
    return { ok: false, paymentId, skipped: false, error: 'invoice_number_failed' };
  }

  const invoiceNumber = typeof invNumRow === 'string'
    ? invNumRow
    : (invNumRow?.next_invoice_number ?? String(invNumRow));

  await appendLog({
    payment_id: paymentId,
    action:     'invoice_number_generated',
    status:     'ok',
    details:    { invoice_number: invoiceNumber },
  });

  // ── Step 4: Generate PDF ──────────────────────────────────
  const paidAt   = new Date();
  const issuedAt = new Date();

  const receiptData = {
    invoiceNumber,
    transactionId: txId,
    orderId:       input.orderId,
    payerEmail,
    payerName,
    productName,
    planId,
    amount,
    currency,
    paidAt,
    issuedAt,
  };

  let pdfBytes;
  try {
    pdfBytes = await generateReceiptPDF(receiptData);
  } catch (e) {
    await appendLog({
      payment_id: paymentId,
      action:     'pdf_generated',
      status:     'error',
      details:    { error: e.message },
    });
    return { ok: false, paymentId, skipped: false, error: 'pdf_generation_failed' };
  }

  await appendLog({
    payment_id: paymentId,
    action:     'pdf_generated',
    status:     'ok',
    details:    { invoice_number: invoiceNumber },
  });

  // ── Step 5: Upload PDF to Supabase Storage ────────────────
  const storagePath = getStoragePath(txId, paidAt);

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('receipts')
    .upload(storagePath, pdfBytes, {
      contentType:  'application/pdf',
      cacheControl: '3600',
      upsert:       true,
    });

  if (uploadErr) {
    await appendLog({
      payment_id: paymentId,
      action:     'pdf_uploaded',
      status:     'error',
      details:    { error: uploadErr.message },
    });
    return { ok: false, paymentId, skipped: false, error: 'storage_upload_failed' };
  }

  // ── Step 6: Generate signed URL ──────────────────────────
  const { data: signedUrlData } = await supabaseAdmin.storage
    .from('receipts')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

  const receiptUrl = signedUrlData?.signedUrl ?? null;

  await appendLog({
    payment_id: paymentId,
    action:     'pdf_uploaded',
    status:     'ok',
    details:    { storage_path: storagePath },
  });
  await appendLog({
    payment_id: paymentId,
    action:     'receipt_url_saved',
    status:     'ok',
    details:    { receipt_url: receiptUrl },
  });

  // ── Step 7: Insert invoice record + update payment ───────
  const { data: invoiceRow, error: invoiceErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      payment_id:     paymentId,
      invoice_number: invoiceNumber,
      pdf_url:        receiptUrl,
      storage_path:   storagePath,
    })
    .select('id')
    .single();

  if (invoiceErr) {
    await appendLog({
      payment_id: paymentId,
      action:     'invoice_created',
      status:     'error',
      details:    { error: invoiceErr.message },
    });
    // Non-fatal: continue pipeline
  } else {
    await appendLog({
      payment_id: paymentId,
      action:     'invoice_created',
      status:     'ok',
      details:    { invoice_id: invoiceRow?.id, invoice_number: invoiceNumber },
    });
  }

  // Update payment with receipt info
  await supabaseAdmin
    .from('payments')
    .update({
      receipt_url: receiptUrl,
      invoice_id:  invoiceRow?.id ?? null,
    })
    .eq('id', paymentId);

  // ── Step 8: Activate user access ─────────────────────────
  const validUntil = getValidUntil(planId);

  const { error: accessErr } = await supabaseAdmin.rpc('activate_user_access', {
    p_payer_email: payerEmail,
    p_plan_id:     planId,
    p_payment_id:  paymentId,
    p_valid_until: validUntil.toISOString(),
  });

  if (accessErr) {
    await appendLog({
      payment_id: paymentId,
      action:     'access_granted',
      status:     'error',
      details:    { error: accessErr.message },
    });
    // Non-fatal — continue with email
  } else {
    await appendLog({
      payment_id: paymentId,
      action:     'access_granted',
      status:     'ok',
      details:    { plan_id: planId, valid_until: validUntil.toISOString() },
    });
  }

  // ── Step 9: Send welcome email ────────────────────────────
  const emailResult = await sendWelcomeEmail({
    to:              payerEmail,
    payerName,
    invoiceNumber,
    transactionId:   txId,
    productName,
    planId,
    amount,
    currency,
    paidAt,
    validUntil,
    receiptPdfBytes: pdfBytes,
  });

  await appendLog({
    payment_id: paymentId,
    action:     'welcome_email_sent',
    status:     emailResult.success ? 'ok' : 'error',
    details:    emailResult.success
      ? { message_id: emailResult.messageId }
      : { error: emailResult.error },
  });

  // ── Step 10: Mark fulfilled ───────────────────────────────
  await supabaseAdmin
    .from('payments')
    .update({
      fulfilled_at:   new Date().toISOString(),
      access_granted: !accessErr,
      email_sent:     emailResult.success,
      status:         'completed',
    })
    .eq('id', paymentId);

  await appendLog({
    payment_id: paymentId,
    action:     'fulfillment_complete',
    status:     'ok',
    details:    {
      invoice_number: invoiceNumber,
      access_granted: !accessErr,
      email_sent:     emailResult.success,
    },
  });

  console.log(`[fulfillment] ✅ Complete: ${txId} → ${invoiceNumber} → ${payerEmail}`);

  return { ok: true, paymentId, skipped: false };
}
