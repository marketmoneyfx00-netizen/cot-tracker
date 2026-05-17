import { useState, useEffect, useRef } from 'react';

const POLL_MS = 30 * 60 * 1000; // 30 minutes

export function useMacroSignal() {
  const [macroSignal, setMacroSignal] = useState(null);
  const timer = useRef(null);

  function load() {
    fetch('/api/macro')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d === 'object') setMacroSignal(d); })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  return macroSignal;
}
