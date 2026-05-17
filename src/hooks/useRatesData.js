import { useState, useEffect, useRef } from 'react';

const POLL_MS = 4 * 60 * 60 * 1000; // 4 hours — rates change slowly

export function useRatesData() {
  const [ratesData, setRatesData] = useState(null);
  const timer = useRef(null);

  function load() {
    fetch('/api/rates')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d === 'object') setRatesData(d); })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  return ratesData;
}
