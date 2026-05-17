export function buildDecision({ totalScore, scoreT, scoreF }) {

  // 🛡️ protección de inputs
  if (
    typeof totalScore !== 'number' ||
    typeof scoreT !== 'number' ||
    typeof scoreF !== 'number'
  ) {
    return {
      type: 'neutral',
      message: '⚖️ Mercado sin datos suficientes',
      sub: 'Esperando información válida',
    };
  }

  const bias =
    totalScore > 20  ? 'bullish' :
    totalScore < -20 ? 'bearish' :
    'neutral';

  // ⚠️ prioridad: mercado sin movimiento real
  if (Math.abs(scoreT) < 1) {
    return {
      type: 'no_confirmation',
      message: '⚠️ Mercado en compresión',
      sub: 'Sin confirmación técnica — evitar entradas',
    };
  }

  // ⚖️ mercado neutro
  if (bias === 'neutral') {
    return {
      type: 'neutral',
      message: '⚖️ Mercado sin dirección',
      sub: 'Esperar ruptura antes de operar',
    };
  }

  // 📈 alineado alcista
  if (bias === 'bullish' && scoreT > 0 && scoreF > 0) {
    return {
      type: 'bullish',
      message: '📈 Bullish structural flow',
      sub: 'Pullback monitoring active — await price structure',
    };
  }

  // 📉 alineado bajista
  if (bias === 'bearish' && scoreT < 0 && scoreF < 0) {
    return {
      type: 'bearish',
      message: '📉 Bearish structural flow',
      sub: 'Bounce monitoring active — await price structure',
    };
  }

  // ⚠️ divergencia
  return {
    type: 'divergence',
    message: '⚠️ Structural divergence',
    sub: 'HTF and short-term data conflict — reduce exposure',
  };
}
