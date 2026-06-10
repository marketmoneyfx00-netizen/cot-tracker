// =============================================================================
// POLYMARKET × COT TRACKER — PUBLIC API
// src/polymarket/index.js
//
// Single entry point for all Polymarket integration exports.
// Engines and components import from here, never from internal paths.
// =============================================================================

// Service singleton
export { polymarketService } from './PolymarketService.js';

// Signal bus
export { signalBus } from './signals/SignalBus.js';

// Engine adapters
export {
  BiasEngineAdapter,
  DivergenceEngineAdapter,
  RegimeEngineAdapter,
  EventLayerAdapter,
  NarrativeEngineAdapter,
} from './integrations/EngineAdapters.js';

// React hooks (Phase 2+ UI integration)
export {
  usePolymarketContext,
  useBiasModifier,
  useEventContext,
} from './hooks/usePolymarketContext.js';

// Metric functions (for testing / direct use)
export {
  calculateConsensusVelocity,
  calculatePolicyUncertaintyIndex,
  calculateRecessionRiskComposite,
  calculateGeopoliticalTailRiskPulse,
  calculateMacroStressComposite,
  calculateNarrativeTransitionScore,
  calculateFedDivergenceSignal,
  calculateBiasModifier,
  generateSystemExplanation,
} from './metrics/MetricEngine.js';

