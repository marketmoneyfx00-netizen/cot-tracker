/**
 * api/_lib/email/resend.js
 *
 * Sends transactional emails via Resend.
 * Install: npm install resend
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL    = process.env.RESEND_FROM_EMAIL   || 'COT Tracker <noreply@marketmoneyfx.com>';
const REPLY_TO      = process.env.RESEND_REPLY_EMAIL  || 'support@marketmoneyfx.com';
const DASHBOARD_URL = process.env.APP_URL             || 'https://app.cot-tracker.com';

const PLAN_LABELS = {
  mensual:    'Plan Mensual',
  trimestral: 'Plan Trimestral',
  semestral:  'Plan Semestral',
  anual:      'Plan Anual',
};

export async function sendWelcomeEmail(data) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping email');
    return { success: false, error: 'resend_not_configured' };
  }

  const name      = data.payerName ?? data.to.split('@')[0];
  const planLabel = PLAN_LABELS[data.planId] ?? data.planId;
  const amountStr = formatAmount(data.amount, data.currency);
  const dateStr   = formatDate(data.paidAt);
  const validStr  = formatDate(data.validUntil);

  const vars = { ...data, name, planLabel, amountStr, dateStr, validStr };

  try {
    const { data: result, error } = await resend.emails.send({
      from:     FROM_EMAIL,
      to:       data.to,
      replyTo:  REPLY_TO,
      subject:  '✅ Bienvenido a COT Tracker — Acceso activado',
      attachments: [
        {
          filename:    `recibo_${data.invoiceNumber}.pdf`,
          content:     Buffer.from(data.receiptPdfBytes),
          contentType: 'application/pdf',
        },
      ],
      html: buildHtml(vars),
      text: buildText(vars),
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: result?.id };

  } catch (err) {
    console.error('[email] Unexpected error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── HTML template ─────────────────────────────────────────────

function buildHtml(v) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bienvenido a COT Tracker</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0B3366;padding:28px 32px;">
          <p style="margin:0;font-size:20px;font-weight:800;color:white;letter-spacing:-0.3px;">COT Tracker</p>
          <p style="margin:4px 0 0;font-size:11px;color:rgba(180,210,255,0.9);letter-spacing:0.08em;">MARKETMONEYFX</p>
        </td></tr>

        <!-- Accent strip -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#0080CC,#0055aa);"></td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 32px 24px;">
          <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1c1d24;">✅ Acceso activado</p>
          <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
            Hola <strong>${escHtml(v.name)}</strong>, tu pago ha sido confirmado y tu acceso a COT Tracker Beta está activo.
          </p>

          <!-- Details box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              ${detailRow('Plan',               v.planLabel)}
              ${detailRow('Importe',            v.amountStr)}
              ${detailRow('Fecha de pago',      v.dateStr)}
              ${detailRow('Acceso válido hasta', v.validStr)}
              ${detailRow('N.º de factura',      v.invoiceNumber)}
              ${detailRow('Transacción',         v.transactionId)}
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0 24px;">
              <a href="${DASHBOARD_URL}"
                 style="display:inline-block;background:#0055cc;color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:-0.1px;">
                Acceder al Dashboard →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#8e8e93;line-height:1.6;">
            Adjunto encontrarás tu recibo oficial en PDF.<br/>
            Para soporte: <a href="mailto:${REPLY_TO}" style="color:#0055cc;">${REPLY_TO}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8f9fc;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">
            COT Tracker · MarketMoneyFX · app.cot-tracker.com<br/>
            Producto digital — acceso SaaS.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:4px 0;font-size:13px;color:#8e8e93;width:160px;">${escHtml(label)}</td>
    <td style="padding:4px 0;font-size:13px;color:#1c1d24;font-weight:600;">${escHtml(String(value ?? ''))}</td>
  </tr>`;
}

function buildText(v) {
  return `Bienvenido a COT Tracker Beta, ${v.name}

Tu pago ha sido confirmado y tu acceso está activo.

Plan: ${v.planLabel}
Importe: ${v.amountStr}
Fecha de pago: ${v.dateStr}
Válido hasta: ${v.validStr}
Factura: ${v.invoiceNumber}
Transacción: ${v.transactionId}

Accede al dashboard: ${DASHBOARD_URL}

Recibo PDF adjunto.
Soporte: ${REPLY_TO}

COT Tracker · Market Money FX`;
}

// ── Helpers ───────────────────────────────────────────────────

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

function formatDate(d) {
  return d.toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
