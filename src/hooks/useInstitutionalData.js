// =============================================================================
// useInstitutionalData — React hook
//
// Orchestrates all Financial Datasets service calls and engine computations.
// Designed to run silently in background after app mount.
//
// Usage:
//   const { institutionalData, loading, error } = useInstitutionalData({ pair, cotBiasScore, macroSignal });
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { fdService, fdClient }           from '../services/financialDatasets/index.js';
import { computeEquityIntelligence }    from '../engines/fd/equityIntelligenceEngine.js';
import { computeEarningsRegime }        from '../engines/fd/earningsRegimeEngine.js';
import { computeBalanceSheetStress }    from '../engines/fd/balanceSheetStressEngine.js';
import { generateInstitutionalNarrative } from '../engines/fd/institutionalNarrativeEngine.js';
import { computeInstitutionalComposite }  from '../engines/fd/institutionalCompositeEngine.js';

// ── FX pair → equity proxy mapping ───────────────────────────────────────────
// Uses individual stocks (not ETFs) because Financial Datasets API only provides
// income/balance/cashflow statements for individual companies, not ETFs.
// Proxies chosen as major ADRs listed in the US that correlate with each currency.
const PAIR_EQUITY_MAP = {
  'EUR/USD':   { ticker: 'SAP',  sector: 'technology', label: 'SAP SE (ADR)' },
  'GBP/USD':   { ticker: 'BP',   sector: 'energy',     label: 'BP PLC (ADR)' },
  'USD/JPY':   { ticker: 'TM',   sector: 'automotive', label: 'Toyota Motor (ADR)' },
  'USD/CHF':   { ticker: 'NVS',  sector: 'healthcare', label: 'Novartis AG (ADR)' },
  'USD/CAD':   { ticker: 'SU',   sector: 'energy',     label: 'Suncor Energy' },
  'AUD/USD':   { ticker: 'BHP',  sector: 'materials',  label: 'BHP Group (ADR)' },
  'NZD/USD':   { ticker: 'RIO',  sector: 'materials',  label: 'Rio Tinto (ADR)' },
  'USD Index': { ticker: 'JPM',  sector: 'financials', label: 'JPMorgan Chase' },
};

const REFRESH_INTERVAL = 5 * 60_000; // 5 minutes

// ── Async data loader ─────────────────────────────────────────────────────────

async function loadAllData(pair, cotBiasScore, macroSignal, signal) {
  if (!fdService.isAvailable()) {
    throw Object.assign(new Error('Financial Datasets API unavailable (circuit breaker open)'), { code: 'CIRCUIT_OPEN' });
  }

  const equityProxy = PAIR_EQUITY_MAP[pair];

  const [macroBasket, equityBundle, earnings] = await Promise.allSettled([
    fdService.getMacroBasket(),
    equityProxy ? fdService.getEquity(equityProxy.ticker) : Promise.resolve(null),
    equityProxy ? fdService.getEarnings(equityProxy.ticker) : Promise.resolve(null),
  ]);

  if (signal?.aborted) throw new Error('Aborted');

  const macroBasketData = macroBasket.status === 'fulfilled' ? macroBasket.value : null;
  const equityData      = equityBundle.status === 'fulfilled' ? equityBundle.value : null;
  const earningsData    = earnings.status === 'fulfilled'     ? earnings.value     : null;

  // Run engines
  const macroContext = buildMacroContext(macroSignal, macroBasketData);

  const equityIntel  = equityData
    ? computeEquityIntelligence(equityData, equityProxy?.sector)
    : null;

  const earningsRegime = earningsData
    ? computeEarningsRegime(earningsData, macroContext)
    : null;

  const stressEngine = equityData
    ? computeBalanceSheetStress(
        equityData.balance,
        equityData.cashflow,
        equityData.income,
        macroContext
      )
    : null;

  const narrative = generateInstitutionalNarrative({
    cotBias:      buildCotBiasInput(cotBiasScore),
    equityIntel,
    earningsRegime,
    stressEngine,
    macroContext,
    pair,
  });

  const composite = computeInstitutionalComposite({
    cotBiasScore,
    macroSignal,
    equityIntel,
    earningsRegime,
    stressEngine,
  });

  return {
    equityIntel,
    equityProxy,
    earningsRegime,
    stressEngine,
    macroBasket:  macroBasketData,
    narrative,
    composite,
    macroContext,
    loadedAt: new Date().toISOString(),
  };
}

function buildMacroContext(macroSignal, macroBasket) {
  const tltSnap  = macroBasket?.snapshots?.TLT;
  const dxySnap  = macroBasket?.snapshots?.UUP;
  const spySnap  = macroBasket?.snapshots?.SPY;

  const tltChg   = tltSnap?.changePercent ?? 0;
  const dxyChg   = dxySnap?.changePercent ?? 0;
  const spyChg   = spySnap?.changePercent ?? 0;

  const yieldEnv = tltChg < -0.5 ? 'HIGH' : tltChg > 0.5 ? 'LOW' : 'NEUTRAL';
  const dxyTrend = dxyChg > 0.3 ? 'RISING' : dxyChg < -0.3 ? 'FALLING' : 'FLAT';
  const riskRegime = spyChg > 0.5 ? 'risk_on' : spyChg < -0.5 ? 'risk_off' : 'neutral';

  return {
    yieldEnv,
    dxyTrend,
    riskRegime,
    interestRateEnv: yieldEnv,
    fedStance: macroSignal?.fedStance ?? 'neutral',
  };
}

function buildCotBiasInput(score) {
  if (score == null) return null;
  const abs = Math.abs(score);
  return {
    score,
    direction: score > 1 ? 'bullish' : score < -1 ? 'bearish' : 'neutral',
    magnitude: abs > 4 ? 'extreme_long' : abs > 2 ? 'strong' : 'moderate',
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInstitutionalData({ pair, cotBiasScore, macroSignal, enabled = true }) {
  const [state, setState] = useState({
    institutionalData: null,
    loading: false,
    error: null,
    lastUpdated: null,
  });

  const abortRef    = useRef(null);
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    if (!enabled || !pair) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const data = await loadAllData(pair, cotBiasScore, macroSignal, controller.signal);

      if (!controller.signal.aborted) {
        setState({
          institutionalData: data,
          loading: false,
          error: null,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      if (err.message === 'Aborted' || controller.signal.aborted) return;

      const isCircuitOpen = err.code === 'CIRCUIT_OPEN';
      setState(prev => ({
        ...prev,
        loading: false,
        error: {
          message: err.message,
          code: err.code ?? 'UNKNOWN',
          isCircuitOpen,
          retryIn: isCircuitOpen ? 60 : null,
        },
      }));
    }
  }, [pair, cotBiasScore, macroSignal, enabled]);

  // Initial load + refresh interval
  useEffect(() => {
    if (!enabled) return;

    load();

    intervalRef.current = setInterval(load, REFRESH_INTERVAL);

    return () => {
      abortRef.current?.abort();
      clearInterval(intervalRef.current);
    };
  }, [load, enabled]);

  const retry = useCallback(() => {
    fdClient.resetBreaker();
    fdService.resetCache();
    load();
  }, [load]);

  return {
    ...state,
    retry,
    isAvailable: fdService.isAvailable(),
  };
}
