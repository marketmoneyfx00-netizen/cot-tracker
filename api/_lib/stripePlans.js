/**
 * api/_lib/stripePlans.js — Single source of truth for Stripe price IDs.
 *
 * IMPORTANT: When a Stripe price is updated, update ONLY this file.
 * Both create-checkout-session.js and fulfillment.js import from here.
 * Keeping two separate maps caused silent plan-resolution failures (premortem fallo 7).
 */

export const PRICE_ID_TO_PLAN = {
  'price_1TQdW7B7QeisGCzWnuzk8SLI': 'mensual',
  'price_1TQdc6B7QeisGCzWYXRSJNGc': 'trimestral',
  'price_1TQdfUB7QeisGCzWkhQSRQAE': 'semestral',
  'price_1TQdhfB7QeisGCzWEoFsJFhm': 'anual',
};

export const VALID_PRICE_IDS = new Set(Object.keys(PRICE_ID_TO_PLAN));

export const PLAN_NAMES = {
  mensual:    'COT Tracker — Plan Mensual',
  trimestral: 'COT Tracker — Plan Trimestral',
  semestral:  'COT Tracker — Plan Semestral',
  anual:      'COT Tracker — Plan Anual',
};

export const PLAN_FALLBACK_DAYS = { mensual: 30, trimestral: 90, semestral: 180, anual: 365 };
