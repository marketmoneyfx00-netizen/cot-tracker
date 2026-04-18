// api/payments/webhook.js

import { verifyPayPalWebhook } from "./verify.js";
import { fulfillPayment } from "./fulfillment.js";

// ✅ FIX #1: Ruta corregida — era "../lib/supabase/admin.js" (sin _)
import { supabaseAdmin, appendLog } from "../_lib/supabase/admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. HEADERS ────────────────────────────────────────────
    const headers = {
      "paypal-auth-algo":        req.headers["paypal-auth-algo"]        || "",
      "paypal-cert-url":         req.headers["paypal-cert-url"]         || "",
      "paypal-transmission-id":  req.headers["paypal-transmission-id"]  || "",
      "paypal-transmission-sig": req.headers["paypal-transmission-sig"] || "",
      "paypal-transmission-time":req.headers["paypal-transmission-time"]|| "",
    };

    if (!headers["paypal-transmission-id"] || !headers["paypal-transmission-sig"]) {
      console.warn("[webhook] Missing PayPal headers");
      return res.status(400).json({ error: "Missing headers" });
    }

    // ── 2. RAW BODY ───────────────────────────────────────────
    // Vercel parsea req.body como objeto JSON automáticamente.
    // Re-serializamos para la verificación de firma de PayPal.
    const rawBody = JSON.stringify(req.body);

    if (!req.body || typeof req.body !== "object") {
      console.warn("[webhook] Empty or invalid body");
      return res.status(400).json({ error: "Invalid body" });
    }

    // ── 3. VERIFY ─────────────────────────────────────────────
    // ✅ FIX #2: Envuelto en try/catch para que un fallo de verificación
    // no crashee toda la función — devuelve 401 limpiamente.
    let isValid = false;
    try {
      isValid = await verifyPayPalWebhook(headers, rawBody);
    } catch (verifyErr) {
      console.error("[webhook] Verify threw:", verifyErr.message);
      // Si PAYPAL_WEBHOOK_ID no está configurado, rechazamos sin crashear
      return res.status(401).json({ error: "Verification failed" });
    }

    if (!isValid) {
      console.warn("[webhook] Invalid PayPal signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // ── 4. EVENT ──────────────────────────────────────────────
    const event     = req.body;
    const eventType = event?.event_type;
    const eventId   = event?.id;
    const resource  = event?.resource || {};

    if (!eventType) {
      console.warn("[webhook] Missing event_type");
      return res.status(400).json({ error: "Missing event_type" });
    }

    console.log(`[webhook] ${eventType} | ${eventId}`);

    // ── 5. ROUTING ────────────────────────────────────────────
    switch (eventType) {

      // ── PAGO COMPLETADO ──────────────────────────────────────
      case "PAYMENT.CAPTURE.COMPLETED": {
        try {
          const result = await fulfillPayment({
            capture:  resource,
            payer:    event.resource?.payer || {},
            orderId:
              resource?.supplementary_data?.related_ids?.order_id ||
              event.resource?.order_id ||
              null,
            rawEvent: event,
          });

          if (!result.ok) {
            console.error("[webhook] Fulfillment failed:", result.error);
          } else if (result.skipped) {
            console.log("[webhook] Duplicate event — skipped");
          } else {
            console.log("[webhook] Payment fulfilled:", result.paymentId);
          }
        } catch (err) {
          console.error("[webhook] Fulfillment error:", err.message);
          // No re-lanzamos: PayPal necesita un 200 para no reintentar indefinidamente
        }
        break;
      }

      // ── ORDEN APROBADA ────────────────────────────────────────
      case "CHECKOUT.ORDER.APPROVED":
        console.log("[webhook] Order approved — waiting for capture");
        break;

      // ── PAGO DENEGADO ─────────────────────────────────────────
      case "PAYMENT.CAPTURE.DENIED": {
        try {
          const txId = resource.id;
          if (!txId) break;

          const { data: existing } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("provider_transaction_id", txId)
            .maybeSingle();

          let paymentId = existing?.id;

          if (!paymentId) {
            const { data: inserted, error: insertErr } = await supabaseAdmin
              .from("payments")
              .insert({
                provider:                "paypal",
                provider_transaction_id: txId,
                payer_email:             resource?.payer?.email_address || "unknown",
                amount:                  parseFloat(resource.amount?.value || "0"),
                currency:                resource.amount?.currency_code || "EUR",
                product_name:            "COT Tracker Beta",
                product_type:            "subscription",
                status:                  "denied",
                metadata:                event,
              })
              .select("id")
              .single();

            if (insertErr) {
              console.error("[webhook] Denied insert error:", insertErr.message);
            } else {
              paymentId = inserted?.id;
            }
          } else {
            await supabaseAdmin
              .from("payments")
              .update({ status: "denied" })
              .eq("id", paymentId);
          }

          if (paymentId) {
            await appendLog({
              payment_id: paymentId,
              action:     "payment_denied",
              status:     "ok",
              details:    { tx_id: txId },
            });
          }
        } catch (e) {
          console.error("[webhook] Denied handler error:", e.message);
        }
        break;
      }

      // ── REEMBOLSO ─────────────────────────────────────────────
      case "PAYMENT.CAPTURE.REFUNDED": {
        try {
          const originalCaptureId =
            resource.links?.find((l) => l.rel === "up")?.href?.split("/").pop() ||
            resource.id;

          if (!originalCaptureId) break;

          const { data: payment } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("provider_transaction_id", originalCaptureId)
            .maybeSingle();

          if (payment?.id) {
            await supabaseAdmin
              .from("payments")
              .update({
                status:      "refunded",
                refunded_at: new Date().toISOString(),
              })
              .eq("id", payment.id);

            await appendLog({
              payment_id: payment.id,
              action:     "refund_received",
              status:     "ok",
              details:    {
                refund_id:        resource.id,
                original_capture: originalCaptureId,
              },
            });
          } else {
            console.warn("[webhook] Refund: payment not found for capture", originalCaptureId);
          }
        } catch (e) {
          console.error("[webhook] Refund handler error:", e.message);
        }
        break;
      }

      // ── OTROS EVENTOS ─────────────────────────────────────────
      default:
        console.log("[webhook] Unhandled event type:", eventType);
    }

    // Siempre devolver 200 — PayPal reintenta si no recibe 2xx
    return res.status(200).json({ received: true });

  } catch (err) {
    // Este catch solo debería alcanzarse por errores inesperados en el flujo principal
    console.error("[webhook] Fatal unhandled error:", err.message, err.stack);
    return res.status(500).json({ error: "Internal error" });
  }
}
