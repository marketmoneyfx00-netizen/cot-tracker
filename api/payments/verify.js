// api/payments/verify.js

import { Buffer } from "buffer";

// ─────────────────────────────────────────────
// PayPal OAuth token cache
// ─────────────────────────────────────────────
let _tokenCache = null;

export async function getPayPalAccessToken() {
  const now = Date.now();

  if (_tokenCache && _tokenCache.expiresAt > now + 60000) {
    return _tokenCache.token;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = getPayPalBaseUrl();

  if (!clientId || !clientSecret) {
    throw new Error("[paypal/auth] Missing credentials");
  }

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(
      `[paypal/auth] Token fetch failed: ${res.status} ${await res.text()}`
    );
  }

  const data = await res.json();

  _tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 300) * 1000,
  };

  return _tokenCache.token;
}

// ─────────────────────────────────────────────
// Verify webhook signature
// ─────────────────────────────────────────────
export async function verifyPayPalWebhook(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    throw new Error("[paypal/verify] PAYPAL_WEBHOOK_ID not configured");
  }

  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

let parsedBody;

try {
  parsedBody = JSON.parse(rawBody);
} catch (e) {
  console.error("[paypal/verify] Invalid JSON body");
  return false;
}

  const body = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: parsedBody,
  };

  const res = await fetch(
    `${baseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    console.error("[paypal/verify] API error:", res.status, await res.text());
    return false;
  }

  const result = await res.json();

if (result.verification_status !== "SUCCESS") {
  console.warn("[paypal/verify] Verification failed:", result);
}

return result.verification_status === "SUCCESS";
}

// ─────────────────────────────────────────────
// Base URL
// ─────────────────────────────────────────────
export function getPayPalBaseUrl() {
  return process.env.PAYPAL_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// ─────────────────────────────────────────────
// Plan durations
// ─────────────────────────────────────────────
export const PLAN_DURATIONS_DAYS = {
  mensual: 30,
  trimestral: 90,
  semestral: 180,
  anual: 365,
};

export function getValidUntil(planId) {
  const days = PLAN_DURATIONS_DAYS[planId] || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function resolvePlanId(customId, description) {
  const candidates = ["mensual", "trimestral", "semestral", "anual"];
  const src = (customId || description || "").toLowerCase();

  for (const plan of candidates) {
    if (src.includes(plan)) return plan;
  }

  return "mensual";
}