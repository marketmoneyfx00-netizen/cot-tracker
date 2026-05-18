/**
 * alertsEngine.js — Sistema de alertas basado en decision + scoreT
 *
 * checkAlerts: genera alertas de alta convicción cuando scoreT supera umbrales.
 * Sin estado. Sin dependencias. Función pura.
 */

export function checkAlerts({ decision, scoreT }) {
  const alerts = [];

  if (decision.type === 'bullish' && scoreT > 50) {
    alerts.push({ type: 'BIAS_ALCISTA', message: 'Sesgo institucional alcista destacado' });
  }

  if (decision.type === 'bearish' && scoreT < -50) {
    alerts.push({ type: 'BIAS_BAJISTA', message: 'Sesgo institucional bajista destacado' });
  }

  if (decision.type === 'divergence') {
    alerts.push({ type: 'DIVERGENCIA',  message: 'Divergencia institucional — contexto mixto' });
  }

  return alerts;
}
