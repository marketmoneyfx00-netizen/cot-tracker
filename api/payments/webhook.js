/**
 * api/payments/webhook.js — Stripe Webhook Handler (Production)
 *
 * Vite + Vercel serverless. Body llega como stream raw.
 *
 * Política de errores:
 *   200 → evento procesado OK (o ignorable legítimamente)
 *   400 → firma inválida o request malformado (no reintentar)
 *   500 → fallo de fulfillment → Stripe REINTENTA
 */

import {
  fulfillFromCheckoutSession,
  fulfillFromInvoicePaid,
  handleSubscriptionCancelled,
  handleSubscriptionUpdated,
  handleChargeRefunded,
} from '../_lib/payments/fulfillment.js';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  ()  => resolve(Buffer.concat(chunks)));
    req.on('error', e  => reject(e));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey     = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error('[webhook] CRITICAL: missing STRIPE env vars');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing signature' });

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    console.error('[webhook] Stream read error:', e.message);
    return res.status(400).json({ error: 'Failed to read body' });
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error('[webhook] Invalid signature:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[webhook] ${event.type} | ${event.id} | ${new Date().toISOString()}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`[webhook] mode=${session.mode} | sub=${session.subscription} | customer=${session.customer} | email=${session.customer_details?.email} | auth_user_id=${session.metadata?.auth_user_id}`);

        if (session.mode !== 'subscription') {
          return res.status(200).json({ received: true, note: 'non-subscription session' });
        }
        if (!session.subscription) {
          console.error('[webhook] No subscription_id in completed session');
          return res.status(200).json({ received: true, note: 'no subscription id' });
        }

        const r = await fulfillFromCheckoutSession(session, stripe);
        if (!r.ok && !r.skipped) {
          console.error('[webhook] fulfillFromCheckoutSession FAILED:', r.error);
          return res.status(500).json({ error: r.error }); // → Stripe retry
        }
        console.log(`[webhook] checkout OK | payment=${r.paymentId} | skipped=${r.skipped}`);
        return res.status(200).json({ received: true });
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        console.log(`[webhook] invoice=${invoice.id} | sub=${subId} | reason=${invoice.billing_reason} | customer=${invoice.customer} | auth_user_id=${invoice.subscription_details?.metadata?.auth_user_id}`);

        if (!subId) {
          return res.status(200).json({ received: true, note: 'non-subscription invoice' });
        }

        const r = await fulfillFromInvoicePaid(invoice, stripe);
        if (!r.ok && !r.skipped) {
          console.error('[webhook] fulfillFromInvoicePaid FAILED:', r.error);
          return res.status(500).json({ error: r.error });
        }
        console.log(`[webhook] invoice.paid OK | payment=${r.paymentId} | skipped=${r.skipped}`);
        return res.status(200).json({ received: true });
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const attemptCount = inv.attempt_count ?? 1;
        console.warn(`[webhook] payment_failed | invoice=${inv.id} | sub=${inv.subscription} | attempt=${attemptCount} | next=${inv.next_payment_attempt}`);

        // On FIRST failure: subscription.updated(past_due) is also fired by Stripe,
        // which sets a 3-day grace period. We log here for visibility.
        // On subsequent failures (attempt >= 2) or when next_payment_attempt is null
        // (Stripe has given up): revoke access immediately.
        if (inv.subscription && (attemptCount >= 2 || !inv.next_payment_attempt)) {
          const r = await handleSubscriptionUpdated({
            id:     typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id,
            status: attemptCount >= 3 ? 'unpaid' : 'past_due',
            items:  { data: [{ price: { id: inv.lines?.data?.[0]?.price?.id ?? null } }] },
            current_period_end: inv.period_end ?? null,
          });
          console.log(`[webhook] payment_failed(attempt=${attemptCount}) → handled as ${attemptCount >= 3 ? 'unpaid' : 'past_due'}: ok=${r.ok}`);
        }
        return res.status(200).json({ received: true });
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        console.log(`[webhook] subscription.deleted | sub=${sub.id} | customer=${sub.customer}`);

        const r = await handleSubscriptionCancelled(sub);
        if (!r.ok) {
          // No devolvemos 500 en cancelaciones — Stripe no reintentará de forma útil
          console.error('[webhook] handleSubscriptionCancelled FAILED:', r.error);
        } else {
          console.log(`[webhook] cancellation OK | note=${r.note ?? 'none'}`);
        }
        return res.status(200).json({ received: true });
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        console.log(`[webhook] subscription.updated | sub=${sub.id} | status=${sub.status} | plan=${sub.items?.data?.[0]?.price?.id}`);

        const r = await handleSubscriptionUpdated(sub);
        if (!r.ok) {
          console.error('[webhook] handleSubscriptionUpdated FAILED:', r.error);
        } else {
          console.log(`[webhook] subscription.updated OK | skipped=${r.skipped ?? false}`);
        }
        return res.status(200).json({ received: true });
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        console.log(`[webhook] charge.refunded | charge=${charge.id} | refunded=${charge.amount_refunded}/${charge.amount}`);

        const r = await handleChargeRefunded(charge);
        if (!r.ok) {
          console.error('[webhook] handleChargeRefunded FAILED:', r.error);
        } else {
          console.log(`[webhook] charge.refunded OK | skipped=${r.skipped ?? false}`);
        }
        return res.status(200).json({ received: true });
      }

      default:
        console.log(`[webhook] Unhandled (safe): ${event.type}`);
        return res.status(200).json({ received: true, note: 'unhandled event' });
    }

  } catch (err) {
    console.error(`[webhook] Uncaught error in ${event.type}:`, err.message, err.stack);
    return res.status(500).json({ error: 'Internal fulfillment error' });
  }
}
