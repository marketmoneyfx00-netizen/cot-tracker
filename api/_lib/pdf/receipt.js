/**
 * api/_lib/pdf/receipt.js
 *
 * Generates a professional PDF receipt using pdf-lib.
 * Install: npm install pdf-lib
 *
 * Output: Uint8Array (PDF bytes) ready for Supabase Storage upload.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Brand colors (COT Tracker navy)
const C = {
  navy:  rgb(0.043, 0.200, 0.400),
  teal:  rgb(0.000, 0.502, 0.800),
  light: rgb(0.941, 0.957, 0.973),
  grey:  rgb(0.553, 0.553, 0.600),
  black: rgb(0.110, 0.114, 0.141),
  white: rgb(1.000, 1.000, 1.000),
  green: rgb(0.067, 0.757, 0.282),
};

export async function generateReceiptPDF(data) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]);  // A4 portrait

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  // ── Header band ───────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: C.navy });

  page.drawText('COT TRACKER', {
    x: 40, y: height - 52,
    size: 22, font: bold, color: C.white,
  });
  page.drawText('Market Money FX', {
    x: 40, y: height - 70,
    size: 10, font: regular, color: rgb(0.7, 0.85, 1.0),
  });
  page.drawText('RECIBO', {
    x: width - 120, y: height - 50,
    size: 18, font: bold, color: C.white,
  });
  page.drawText(data.invoiceNumber, {
    x: width - 140, y: height - 68,
    size: 10, font: regular, color: rgb(0.7, 0.85, 1.0),
  });

  // ── Teal accent strip ────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 94, width, height: 4, color: C.teal });

  // ── Document details block ───────────────────────────────
  let y = height - 130;

  const drawRow = (label, value, highlight = false) => {
    page.drawText(label + ':', {
      x: 40, y, size: 9, font: regular, color: C.grey,
    });
    page.drawText(String(value ?? ''), {
      x: 180, y, size: 9,
      font: highlight ? bold : regular,
      color: highlight ? C.teal : C.black,
    });
    y -= 18;
  };

  drawRow('Número de factura',  data.invoiceNumber, true);
  drawRow('Transacción PayPal', data.transactionId);
  if (data.orderId) drawRow('Order ID', data.orderId);
  drawRow('Fecha de pago',    formatDate(data.paidAt));
  drawRow('Fecha de emisión', formatDate(data.issuedAt));

  y -= 12;

  // ── Divider ──────────────────────────────────────────────
  page.drawLine({
    start: { x: 40, y }, end: { x: width - 40, y },
    thickness: 0.5, color: C.light,
  });
  y -= 24;

  // ── Buyer info ───────────────────────────────────────────
  page.drawText('COMPRADOR', {
    x: 40, y, size: 8, font: bold, color: C.grey, characterSpacing: 1.5,
  });
  y -= 16;

  if (data.payerName) drawRow('Nombre', data.payerName);
  drawRow('Email', data.payerEmail);

  y -= 12;

  page.drawLine({
    start: { x: 40, y }, end: { x: width - 40, y },
    thickness: 0.5, color: C.light,
  });
  y -= 24;

  // ── Product table ────────────────────────────────────────
  page.drawText('DETALLE DEL PEDIDO', {
    x: 40, y, size: 8, font: bold, color: C.grey, characterSpacing: 1.5,
  });
  y -= 8;

  page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 22, color: C.light });
  page.drawText('Producto', { x: 52, y: y - 14, size: 9, font: bold, color: C.black });
  page.drawText('Tipo',     { x: 290, y: y - 14, size: 9, font: bold, color: C.black });
  page.drawText('Importe',  { x: width - 120, y: y - 14, size: 9, font: bold, color: C.black });

  y -= 36;

  page.drawText(data.productName, { x: 52, y, size: 10, font: regular, color: C.black });
  page.drawText('Suscripción SaaS', { x: 290, y, size: 10, font: regular, color: C.black });
  page.drawText(
    formatAmount(data.amount, data.currency),
    { x: width - 120, y, size: 10, font: bold, color: C.navy }
  );

  y -= 16;

  page.drawLine({
    start: { x: 40, y }, end: { x: width - 40, y },
    thickness: 0.5, color: C.light,
  });
  y -= 24;

  // ── Total box ────────────────────────────────────────────
  page.drawRectangle({
    x: width - 200, y: y - 42, width: 160, height: 52,
    color: C.navy, borderRadius: 6,
  });
  page.drawText('TOTAL PAGADO', {
    x: width - 185, y: y - 18,
    size: 8, font: bold, color: rgb(0.7, 0.85, 1.0), characterSpacing: 1,
  });
  page.drawText(formatAmount(data.amount, data.currency), {
    x: width - 185, y: y - 36,
    size: 16, font: bold, color: C.white,
  });

  // ── PAGADO badge ─────────────────────────────────────────
  y -= 70;

  page.drawRectangle({
    x: 40, y: y - 4, width: 70, height: 20,
    color: rgb(0.067 * 0.15, 1 * 0.15, 0.282 * 0.15 + 0.85),
    borderRadius: 4,
  });
  page.drawText('PAGADO', {
    x: 48, y: y + 2, size: 9, font: bold, color: C.green,
  });

  // ── Notes ────────────────────────────────────────────────
  y -= 32;

  page.drawText('Notas', { x: 40, y, size: 9, font: bold, color: C.grey });
  y -= 14;

  const notes = [
    'Producto digital — acceso SaaS. No sujeto a devolución una vez activado el acceso.',
    'Para soporte, contacta: support@marketmoneyfx.com',
    'Este documento es su recibo oficial de pago.',
  ];

  for (const note of notes) {
    page.drawText('·  ' + note, {
      x: 40, y, size: 8, font: regular, color: C.grey,
    });
    y -= 13;
  }

  // ── Footer ───────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height: 36, color: C.light });
  page.drawText('COT Tracker — Market Money FX  |  cot-tracker.vercel.app', {
    x: 40, y: 13, size: 8, font: regular, color: C.grey,
  });
  page.drawText('Documento generado automáticamente', {
    x: width - 230, y: 13, size: 8, font: regular, color: C.grey,
  });

  const bytes = await doc.save();
  return bytes;
}

// ── Helpers ───────────────────────────────────────────────────

function formatDate(d) {
  return d.toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });
}

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency,
  }).format(amount);
}

/**
 * Returns the storage path for a receipt PDF.
 * Pattern: receipts/YYYY/MM/receipt_<transactionId>.pdf
 */
export function getStoragePath(transactionId, paidAt) {
  const yyyy = paidAt.getFullYear();
  const mm   = String(paidAt.getMonth() + 1).padStart(2, '0');
  const safe = transactionId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `receipts/${yyyy}/${mm}/receipt_${safe}.pdf`;
}
