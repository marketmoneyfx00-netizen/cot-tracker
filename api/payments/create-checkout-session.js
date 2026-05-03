/**
 * api/payments/create-checkout-session.js
 *
 * Crea un Stripe Customer explícito antes de la sesión de pago.
 *
 * GARANTÍAS:
 *   1. userId (auth.users.id) OBLIGATORIO — 401 si falta o es inválido
 *   2. priceId en whitelist — 400 si no está
 *   3. Stripe Customer siempre tiene metadata.auth_user_id
 *   4. customers.search como intento de deduplicación, pero NO como bloqueante:
 *      si search falla o devuelve vacío → se crea Customer nuevo directamente
 *   5. Email completamente opcional — el sistema funciona sin él
 *      (Apple Pay, Google Pay, métodos europeos que no proporcionan email)
 *
 * POST /api/payments/create-checkout-session
 * Body: { priceId: string, userId: string, userEmail?: string }
 * Returns: { url: string }
 */

const VALID_PRICE_IDS = new Set([
  'price_1TQdW7B7QeisGCzWnuzk8SLI', // Mensual    24 EUR
  'price_1TQdc6B7QeisGCzWYXRSJNGc', // Trimestral 59 EUR
  'price_1TQdfUB7QeisGCzWkhQSRQAE', // Semestral  99 EUR
  'price_1TQdhfB7QeisGCzWEoFsJFhm', // Anual     169 EUR
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { priceId, userId, userEmail } = req.body ?? {};

  // ── Validar priceId ───────────────────────────────────────────────────────
  if (!priceId || typeof priceId !== 'string' || !VALID_PRICE_IDS.has(priceId)) {
    console.warn('[checkout] Rejected: invalid priceId:', priceId);
    return res.status(400).json({ error: 'Invalid price ID' });
  }

  // ── Validar userId — OBLIGATORIO ──────────────────────────────────────────
  if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
    console.error('[checkout] BLOCKED: missing or malformed userId:', userId);
    return res.status(401).json({
      error: 'Valid authenticated user ID required before purchasing.',
    });
  }

  // Email es completamente opcional — sistema funciona sin él
  const safeEmail = (typeof userEmail === 'string' && userEmail.includes('@'))
    ? userEmail.toLowerCase().trim().slice(0, 254)
    : null;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('[checkout] STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });

  const appUrl = process.env.APP_URL || 'https://cot-tracker.vercel.app';

  try {
    // ── Obtener o crear Stripe Customer ───────────────────────────────────
    //
    // ESTRATEGIA DE DEDUPLICACIÓN:
    //   1. customers.search por metadata.auth_user_id
    //      → Intento de deduplicación (evitar customers duplicados)
    //      → NO es bloqueante: si falla o devuelve vacío, continuamos
    //      → Nota: search puede tener latencia de indexación (<60s)
    //   2. Si search no encuentra → crear Customer nuevo directamente
    //      → Garantiza siempre tener un Customer válido
    //      → metadata.auth_user_id siempre presente
    //
    // Aceptamos que en edge cases (reintento muy rápido) puedan crearse
    // dos Customers para el mismo userId. Esto es seguro: el fulfillment
    // recupera auth_user_id desde Customer.metadata, que siempre es correcto.
    // La deduplicación no es crítica — la correctitud sí lo es.

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
      // Search falla en test mode a veces, o por latencia de indexación.
      // No es un error fatal — simplemente creamos Customer nuevo.
      console.warn('[checkout] Customer search failed (non-fatal):', searchErr.message);
    }

    if (!customerId) {
      // Crear Customer con auth_user_id en metadata.
      // Esta es la fuente de verdad permanente para el recovery del webhook.
      const customerParams = {
        metadata: { auth_user_id: userId },
      };
      // Añadir email solo si está disponible — NO requerido
      if (safeEmail) {
        customerParams.email = safeEmail;
      }

      const customer = await stripe.customers.create(customerParams);
      customerId = customer.id;
      console.log(`[checkout] Created Customer: ${customerId} | user: ${userId} | email: ${safeEmail ?? 'none'}`);
    }

    // ── Crear Checkout Session ─────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode:     'subscription',
      customer: customerId,          // Customer explícito con auth_user_id en metadata

      line_items: [{ price: priceId, quantity: 1 }],

      success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/?checkout=cancelled`,

      allow_promotion_codes: true,

      // metadata en session (checkout.session.completed)
      metadata: {
        auth_user_id: userId,
        price_id:     priceId,
      },

      // metadata en subscription — PERSISTE en invoice.paid de renovaciones
      subscription_data: {
        metadata: {
          auth_user_id: userId,
          price_id:     priceId,
        },
      },
    });

    console.log(`[checkout] Session: ${session.id} | customer: ${customerId} | price: ${priceId} | user: ${userId}`);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[checkout] Stripe error:', err.message, err.type ?? '', err.code ?? '');
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
