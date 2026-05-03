/**
 * usePriceStore.js — Conecta priceStore con el ciclo de vida de React.
 *
 * Se suscribe a los cambios del store (via subscribe()) y fuerza un
 * re-render del componente cada vez que llega una vela nueva.
 *
 * Uso en componente:
 *   const candles = usePriceStore();   // devuelve las últimas velas
 *
 * El componente se re-renderiza automáticamente con cada nueva vela.
 * No necesita Zustand, Redux, ni contexto global.
 */

import { useEffect, useState } from 'react';
import { subscribe, getLastCandles } from '../data/priceStore.js';

/**
 * usePriceStore — hook que mantiene las velas sincronizadas con React.
 *
 * @param {number} n — número de velas a devolver (default 3)
 * @returns {Array} — últimas N velas OHLC actualizadas en tiempo real
 */
export function usePriceStore(n = 3) {
  const [candles, setCandles] = useState(() => getLastCandles(n));

  useEffect(() => {
    // Suscribirse: cuando el store notifique un cambio, actualizar el estado
    const unsubscribe = subscribe((allCandles) => {
      setCandles(allCandles.slice(-n));
    });

    // Leer el estado actual al montar (por si ya hay velas)
    setCandles(getLastCandles(n));

    return unsubscribe;
  }, [n]);

  return candles;
}
