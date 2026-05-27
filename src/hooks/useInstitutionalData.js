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
import { fdService }                    from '../services/financialDatasets/index.js';
import { computeEquityIntelligence }    from '../engines/fd/equityIntelligenceEngine.js';
import { computeEarningsRegime }        from '../engines/fd/earningsRegimeEngine.js';
import { computeBalanceSheetStress }    from '../engines/fd/balanceSheetStressEngine.js';
import { computeCryptoMacroLayer }      from '../engines/fd/cryptoMacroLayer.js';
import { generateInstitutionalNarrative } from '../engines/fd/institutionalNarrativeEngine.js';
import { computeInstitutionalComposite }  from '../engines/fd/institutionalCompositeEngine.js';

// ── FX pair → equity proxy mapping ───────────────────────────────────────────
const PAIR_EQUITY_MAP = {
  'EUR/USD': { ticker: 'EWG',   sector: 'consumer',   label: 'iShares MSCI Germany' },
  'GBP/USD': { ticker: 'EWU',   sector: 'financials', label: 'iShares MSCI UK' },
  'USD/JPY': { ticker: 'EWJ',   sector: 'industrials',label: 'iShares MSCI Japan' },
  'USD/CHF': { ticker: 'EWL',   sector: 'financials', label: 'iShares MSCI Switzerland' },
  'USD/CAD': { ticker: 'EWC',   sector: 'energy',     label: 'iShares MSCI Canada' },
  'AUD/USD': { ticker: 'EWA',   sector: 'consumer',   label: 'iShares MSCI Australia' },
  'NZD/USD': { ticker: 'ENZL',  sector: 'consumer',   label: 'iShares MSCI New Zealand' },
  'USD Index': { ticker: 'SPY', sector: 'tech',       label: 'S&P 500 ETF' },
};

const REFRESH_INTERVAL = 5 * 60_000; // 5 minutes

// ── Async data loader ─────────────────────────────────────────────────────────

async function loadAllData(pair, cotBiasScore, macroSignal, signal) {
  if (!fdService.isAvailable()) {
    throw Object.assign(new Error('Financial Datasets API unavailable (circuit breaker open)'), { code: 'CIRCUIT_OPEN' });
  }

  const equityProxy = PAIR_EQUITY_MAP[pair];

  const [macroBasket, cryptoEtf, equityBundle, earnings] = await Promise.allSettled([
    fdService.getMacroBasket(),
    fdService.getCryptoEtf(),
    equityProxy ? fdService.getEquity(equityProxy.ticker) : Promise.resolve(null),
    equityProxy ? fdService.getEarnings(equityProxy.ticker) : Promise.resolve(null),
  ]);

  if (signal?.aborted) throw new Error('Aborted');

  const macroBasketData = macroBasket.status === 'fulfilled' ? macroBasket.value : null;
  const cryptoEtfData   = cryptoEtf.status === 'fulfilled'   ? cryptoEtf.value   : null;
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

  const cryptoLayer = cryptoEtfData
    ? computeCryptoMacroLayer(cryptoEtfData, macroBasketData)
    : null;

  const narrative = generateInstitutionalNarrative({
    cotBias:      buildCotBiasInput(cotBiasScore),
    equityIntel,
    earningsRegime,
    stressEngine,
    cryptoLayer,
    macroContext,
    pair,
  });

  const composite = computeInstitutionalComposite({
    cotBiasScore,
    macroSignal,
    equityIntel,
    earningsRegime,
    stressEngine,
    cryptoLayer,
  });

  return {
    equityIntel,
    equityProxy,
    earningsRegime,
    stressEngine,
    cryptoLayer,
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
    fdService.resetCache();
    load();
  }, [load]);

  return {
    ...state,
    retry,
    isAvailable: fdService.isAvailable(),
  };
}
