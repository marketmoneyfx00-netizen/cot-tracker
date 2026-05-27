/**
 * useAgentConsensus.js — React hook wrapping the multi-agent orchestrator.
 *
 * Memoizes the full AgentConsensus object using all available signal inputs.
 * Only recomputes when meaningful inputs change — debounced at 1 render cycle.
 *
 * Usage:
 *   const consensus = useAgentConsensus({ biasArr, macroSignal, riskRegime, ... });
 */

import { useMemo } from 'react';
import { runAgentConsensus } from '../engines/agents/agentOrchestrator.js';

export function useAgentConsensus({
  biasArr            = [],
  fxPairs            = [],
  allBiasArr         = [],
  combinedData       = null,
  macroSignal        = null,
  ratesData          = null,
  riskRegime         = null,
  sharedLiveVix      = null,
  sentimentData      = {},
  allSentimentData   = {},
  tradeReadinessScore = 100,
  tacStateMap        = {},
  selectedPair       = 'EUR/USD',
  currentContext     = null,
} = {}) {
  return useMemo(() => runAgentConsensus({
    biasArr,
    fxPairs,
    allBiasArr,
    combinedData,
    macroSignal,
    ratesData,
    riskRegime,
    sharedLiveVix,
    sentimentData,
    allSentimentData,
    tradeReadinessScore,
    tacStateMap,
    selectedPair,
    currentContext,
  }), [
    // COT
    biasArr,
    fxPairs,
    allBiasArr,
    combinedData,
    // Macro
    macroSignal,
    ratesData,
    sharedLiveVix,
    // Regime
    riskRegime,
    // Execution
    sentimentData,
    allSentimentData,
    tradeReadinessScore,
    tacStateMap,
    selectedPair,
    currentContext,
  ]);
}
