/**
 * alertsEngine.js — Sistema de alertas basado en decision + scoreT
 *
 * checkAlerts: genera alertas de alta convicción cuando scoreT supera umbrales.
 * Sin estado. Sin dependencias. Función pura.
 */

export function checkAlerts({ decision, scoreT }) {
  const alerts = [];

  if (decision.type === 'bullish' && scoreT > 50) {
    alerts.push({ type: 'BUY_STRONG',  message: '🚀 Compra fuerte detectada' });
  }

  if (decision.type === 'bearish' && scoreT < -50) {
    alerts.push({ type: 'SELL_STRONG', message: '💥 Venta fuerte detectada' });
  }

  if (decision.type === 'divergence') {
    alerts.push({ type: 'WARNING',     message: '⚠️ Divergencia — posible trampa' });
  }

  return alerts;
}
