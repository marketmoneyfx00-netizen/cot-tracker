/**
 * api/payments/create-checkout-session.js
 *
 * POST /api/payments/create-checkout-session
 * Body: { priceId: string, userId: string, userEmail?: string }
 * Returns: { url: string }
 */

import { verifyAuth } from '../_lib/auth-middleware.js';

const VALID_PRICE_IDS = new Set([
  'price_1TQdW7B7QeisGCzWnuzk8SLI', // Mensual    24 EUR
  'price_1TQdc6B7QeisGCzWYXRSjNGc', // Trimestral 59 EUR
  'price_1TQdfUB7QeisGCzWkhQSRQAE', // Semestral  99 EUR
  'price_1TQdhfB7QeisGCzWEoFsJFhm', // Anual     169 EUR
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verificar JWT — el usuario debe estar autenticado ────────────────────
  const { user: jwtUser, error: jwtErr } = await verifyAuth(req);
  if (!jwtUser) {
    console.warn('[checkout] BLOCKED: invalid or missing JWT:', jwtErr);
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const { priceId, userId, userEmail } = req.body ?? {};

  // ── Validar priceId ───────────────────────────────────────────────────────
  if (!priceId || typeof priceId !== 'string' || !VALID_PRICE_IDS.has(priceId)) {
    console.warn('[checkout] Rejected: invalid priceId:', priceId);
    return res.status(400).json({ error: 'Invalid price ID' });
  }

  // ── Validar userId y que coincida con el JWT ──────────────────────────────
  if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
    console.error('[checkout] BLOCKED: missing or malformed userId:', userId);
    return res.status(401).json({ error: 'Valid authenticated user ID required before purchasing.' });
  }

  // Garantizar que el userId del body coincide con el del JWT
  if (jwtUser.id !== userId) {
    console.error('[checkout] BLOCKED: userId mismatch — JWT:', jwtUser.id, 'body:', userId);
    return res.status(403).json({ error: 'User ID mismatch.' });
  }

  const safeEmail = (typeof userEmail === 'string' && userEmail.includes('@'))
    ? userEmail.toLowerCase().trim().slice(0, 254)
    : null;

  // ── Verificar STRIPE_SECRET_KEY ───────────────────────────────────────────
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('[checkout] STRIPE_SECRET_KEY not configured in Vercel environment variables');
    return res.status(500).json({ error: 'Payment system not configured. Contact support.' });
  }

  // ── APP_URL: usar dominio real en producción ──────────────────────────────
  // Prioridad: APP_URL env var → VERCEL_URL (set automáticamente por Vercel) → fallback
  const appUrl = process.env.APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://app.cot-tracker.com';

  let stripe;
  try {
    const { default: Stripe } = await import('stripe');
    stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  } catch (importErr) {
    console.error('[checkout] Failed to import Stripe SDK:', importErr.message);
    return res.status(500).json({ error: 'Payment system initialization failed.' });
  }

  try {
    // ── Obtener o crear Stripe Customer ───────────────────────────────────
    let customerId = null;

    try {
      const searchResult = await stripe.customers.search({
        query: `metadata['auth_user_id']:'${userId}'`,
        limit: 1,
      });
      if (searchResult.data.length > 0) {
        customerId = searchResult.data[0].id;
        console.log(`[checkout] Reusing Customer: ${customerId} | user: ${userId}`);
      }
    } catch (searchErr) {
      console.warn('[checkout] Customer search failed (non-fatal):', searchErr.message);
    }

    if (!customerId) {
      const customerParams = { metadata: { auth_user_id: userId } };
      if (safeEmail) customerParams.email = safeEmail;

      const customer = await stripe.customers.create(customerParams);
      customerId = customer.id;
      console.log(`[checkout] Created Customer: ${customerId} | user: ${userId} | email: ${safeEmail ?? 'none'}`);
    }

    // ── Crear Checkout Session ─────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode:     'subscription',
      customer: customerId,

      line_items: [{ price: priceId, quantity: 1 }],

      success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/?checkout=cancelled`,

      allow_promotion_codes: true,

      metadata: {
        auth_user_id: userId,
        price_id:     priceId,
      },

      subscription_data: {
        metadata: {
          auth_user_id: userId,
          price_id:     priceId,
        },
      },
    });

    if (!session.url) {
      console.error('[checkout] Stripe returned session without URL:', session.id);
      return res.status(500).json({ error: 'Stripe did not return a checkout URL. Try again.' });
    }

    console.log(`[checkout] Session OK: ${session.id} | customer: ${customerId} | price: ${priceId} | user: ${userId}`);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    // ── Logging detallado server-side ─────────────────────────────────────
    console.error('[checkout] Stripe error:', {
      message: err.message,
      type:    err.type    ?? 'unknown',
      code:    err.code    ?? 'unknown',
      param:   err.param   ?? null,
      statusCode: err.statusCode ?? null,
    });

    // ── Mensajes de error específicos para debugging del cliente ──────────
    // Esto ayuda a diagnosticar sin exponer datos sensibles
    let clientError = 'Failed to create checkout session.';

    if (err.type === 'StripeAuthenticationError') {
      clientError = 'Stripe authentication failed. Check STRIPE_SECRET_KEY in Vercel env vars.';
    } else if (err.type === 'StripeInvalidRequestError') {
      // Más probable: price ID no existe en el modo (test/live) de la key
      if (err.message?.includes('No such price')) {
        clientError = `Price ID not found in Stripe. Possible test/live mode mismatch. (${priceId})`;
      } else {
        clientError = `Stripe invalid request: ${err.message}`;
      }
    } else if (err.code === 'resource_missing') {
      clientError = `Stripe resource missing. Price ID may not exist in current mode. (${priceId})`;
    }

    return res.status(500).json({ error: clientError });
  }
}
