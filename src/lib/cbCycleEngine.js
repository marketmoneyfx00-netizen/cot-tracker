/**
 * cbCycleEngine.js — Central Bank Rate Cycle Classifier v1.0
 *
 * Takes the `banks` object from api/rates response (which contains
 * decision history per bank) and produces:
 *   - Current cycle type: HIKING | CUTTING | PAUSED | UNKNOWN
 *   - Cycle magnitude and velocity
 *   - Cumulative move in the current cycle (bps)
 *   - Cycle maturity signal: EARLY | MID | LATE | EXTENDED
 *   - Impact assessment: FX carry implications, bond duration signal, regime weight
 *
 * Design rules:
 *   - Pure function — no side effects, no state
 *   - Works with whatever history is available (degrades gracefully)
 *   - Never invents data. If history < 2 decisions, returns UNKNOWN
 *
 * Input: ratesData.banks (from /api/rates)
 * Output: { [bankId]: CbCycleProfile }
 */

// ── CYCLE DETECTION ───────────────────────────────────────────────────────────

/**
 * Detects the current cycle type from a sequence of rate decisions.
 * @param {Array<{d: string, r: number}>} history - sorted oldest→newest
 * @returns {'HIKING'|'CUTTING'|'PAUSED'|'UNKNOWN'}
 */
function detectCycleType(history) {
  if (!history || history.length < 2) return 'UNKNOWN';

  // Look at last 3 moves (or fewer if history is short)
  const recent = history.slice(-4);
  const moves  = [];

  for (let i = 1; i < recent.length; i++) {
    const delta = Math.round((recent[i].r - recent[i - 1].r) * 100); // bps
    if (Math.abs(delta) >= 5) moves.push(delta); // filter noise
  }

  if (moves.length === 0) return 'PAUSED';

  const hikeCount = moves.filter(m => m > 0).length;
  const cutCount  = moves.filter(m => m < 0).length;

  // Must have consistent direction in last moves
  if (hikeCount > 0 && cutCount === 0) return 'HIKING';
  if (cutCount  > 0 && hikeCount === 0) return 'CUTTING';
  if (moves[moves.length - 1] === 0)    return 'PAUSED';

  // Mixed — use most recent non-zero move
  const lastMove = [...moves].reverse().find(m => m !== 0);
  if (lastMove > 0) return 'HIKING';
  if (lastMove < 0) return 'CUTTING';
  return 'PAUSED';
}

/**
 * Computes cumulative move since cycle inception (bps).
 * Cycle inception = last time the direction reversed.
 */
function computeCycleMagnitude(history) {
  if (!history || history.length < 2) return { cumBps: 0, moveCount: 0, startRate: null };

  // Find last direction reversal
  let cycleStart = 0;
  let lastDir = 0;

  for (let i = 1; i < history.length; i++) {
    const delta = Math.round((history[i].r - history[i - 1].r) * 100);
    if (Math.abs(delta) < 5) continue; // skip pauses

    const dir = delta > 0 ? 1 : -1;
    if (lastDir !== 0 && dir !== lastDir) {
      cycleStart = i; // new cycle started here
    }
    lastDir = dir;
  }

  const cycleHistory  = history.slice(cycleStart);
  const startRate     = cycleHistory[0]?.r ?? null;
  const currentRate   = cycleHistory[cycleHistory.length - 1]?.r ?? null;
  const cumBps        = startRate != null && currentRate != null
    ? Math.round((currentRate - startRate) * 100) : 0;

  const moveCount = cycleHistory.length - 1;

  return { cumBps, moveCount, startRate };
}

/**
 * Classifies cycle maturity.
 * EARLY: ≤ 2 moves, LATE: ≥ 6 moves and rate approaching historic extremes, etc.
 */
function classifyCycleMaturity(cycleType, cumBps, moveCount) {
  if (cycleType === 'UNKNOWN' || cycleType === 'PAUSED') return 'UNKNOWN';

  const absCum = Math.abs(cumBps);

  if (moveCount <= 2)                       return 'EARLY';
  if (moveCount <= 4 && absCum <= 200)      return 'MID';
  if (moveCount >= 5 || absCum >= 300)      return 'LATE';
  if (moveCount >= 7 || absCum >= 500)      return 'EXTENDED';

  return 'MID';
}

/**
 * Computes velocity: average bps per move in the current cycle.
 */
function computeVelocity(cumBps, moveCount) {
  if (moveCount === 0) return 0;
  return Math.round(Math.abs(cumBps) / moveCount);
}

// ── IMPACT ASSESSMENT ─────────────────────────────────────────────────────────

/**
 * Maps cycle type + maturity to carry and FX implications.
 */
function buildCycleImpact(bankId, cycleType, maturity, cumBps, currentRate) {
  const fx = {
    carry_signal:    null,  // 'supportive' | 'headwind' | 'neutral'
    duration_signal: null,  // 'accumulate' | 'reduce' | 'neutral'
    regime_weight:   null,  // contributes to macro regime reading
    notes:           [],
  };

  if (cycleType === 'HIKING') {
    fx.carry_signal    = 'supportive';   // higher rate = carry advantage
    fx.duration_signal = 'reduce';       // rising rates = bond selling
    fx.regime_weight   = 'hawkish';
    if (maturity === 'LATE' || maturity === 'EXTENDED') {
      fx.notes.push(`${bankId} hiking cycle is ${maturity.toLowerCase()} — elevated risk of policy pivot`);
      fx.notes.push('Late-cycle hikes historically coincide with growth deceleration risk');
    } else if (maturity === 'EARLY') {
      fx.notes.push(`${bankId} appears to be entering a new hiking cycle — carry accumulation opportunity`);
    }
  }

  if (cycleType === 'CUTTING') {
    fx.carry_signal    = 'headwind';     // lower rate = carry erosion
    fx.duration_signal = 'accumulate';   // falling rates = bond buying
    fx.regime_weight   = 'dovish';
    if (maturity === 'EARLY') {
      fx.notes.push(`${bankId} initiating rate cuts — watch for carry unwind in ${bankId}-funded pairs`);
    } else if (maturity === 'LATE' || maturity === 'EXTENDED') {
      fx.notes.push(`${bankId} cutting cycle extended (${Math.abs(cumBps)} bps) — diminishing stimulus impact`);
    }
  }

  if (cycleType === 'PAUSED') {
    fx.carry_signal    = 'neutral';
    fx.duration_signal = 'neutral';
    fx.regime_weight   = 'neutral';
    if (currentRate != null && currentRate >= 4.0) {
      fx.notes.push(`${bankId} holding at elevated rate (${currentRate.toFixed(2)}%) — carry structurally supportive while pause holds`);
    } else if (currentRate != null && currentRate <= 0.5) {
      fx.notes.push(`${bankId} near zero-bound — limited conventional ammunition for further easing`);
    }
  }

  return fx;
}

// ── CYCLE LABELS ──────────────────────────────────────────────────────────────

const CYCLE_LABELS = {
  HIKING:   'Hiking Cycle',
  CUTTING:  'Cutting Cycle',
  PAUSED:   'On Hold',
  UNKNOWN:  'Insufficient History',
};

const MATURITY_LABELS = {
  EARLY:    'Early Stage',
  MID:      'Mid Cycle',
  LATE:     'Late Stage',
  EXTENDED: 'Extended / Mature',
  UNKNOWN:  '—',
};

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Builds a cycle profile for every bank in the rates response.
 *
 * @param {Object} ratesData — from /api/rates (contains banks with history arrays)
 * @returns {Object.<string, CbCycleProfile>}
 *
 * CbCycleProfile: {
 *   bankId, currentRate, cycleType, cycleLabel,
 *   maturity, maturityLabel, cumBps, moveCount, velocity,
 *   startRate, impact: { carry_signal, duration_signal, regime_weight, notes },
 *   stanceLabel, stanceScore,
 * }
 */
export function buildCbCycleProfiles(ratesData) {
  if (!ratesData?.banks) return {};

  const profiles = {};

  for (const [bankId, bk] of Object.entries(ratesData.banks)) {
    const history    = bk.history ?? [];   // [{d, r}] oldest → newest
    const cycleType  = detectCycleType(history);
    const { cumBps, moveCount, startRate } = computeCycleMagnitude(history);
    const currentRate = bk.current ?? null;
    const maturity   = classifyCycleMaturity(cycleType, cumBps, moveCount, currentRate);
    const velocity   = computeVelocity(cumBps, moveCount);
    const impact     = buildCycleImpact(bankId, cycleType, maturity, cumBps, currentRate);

    profiles[bankId] = {
      bankId,
      currentRate,
      previousRate:  bk.previous ?? null,
      cycleType,
      cycleLabel:    CYCLE_LABELS[cycleType]   ?? cycleType,
      maturity,
      maturityLabel: MATURITY_LABELS[maturity] ?? maturity,
      cumBps,
      moveCount,
      velocity,
      startRate,
      stanceScore:   bk.stanceScore  ?? 0,
      stanceLabel:   bk.stanceLabel  ?? 'Neutral',
      signalLabel:   bk.signalLabel  ?? 'NEUTRO',
      lastDate:      bk.lastDate     ?? null,
      impact,
    };
  }

  return profiles;
}

/**
 * Derives an aggregate macro regime weight from all CB cycle profiles.
 * Used to supplement the riskRegimeEngine signal with policy cycle context.
 *
 * @param {Object} profiles — from buildCbCycleProfiles()
 * @returns {{ dominant: string, hawkishCount: number, dovishCount: number, neutralCount: number, summary: string }}
 */
export function derivePolicyCycleRegime(profiles) {
  if (!profiles || !Object.keys(profiles).length) {
    return { dominant: 'UNKNOWN', hawkishCount: 0, dovishCount: 0, neutralCount: 0, summary: 'No CB data available.' };
  }

  let hawkish = 0, dovish = 0, neutral = 0;

  for (const p of Object.values(profiles)) {
    if (p.cycleType === 'HIKING' || (p.stanceScore ?? 0) > 0) hawkish++;
    else if (p.cycleType === 'CUTTING' || (p.stanceScore ?? 0) < 0) dovish++;
    else neutral++;
  }

  const total    = hawkish + dovish + neutral;
  const dominant = hawkish > dovish + 1 ? 'HAWKISH_DOMINANT'
                 : dovish > hawkish + 1 ? 'DOVISH_DOMINANT'
                 : 'MIXED';

  const summary = dominant === 'HAWKISH_DOMINANT'
    ? `${hawkish} of ${total} tracked central banks are in hiking or hawkish-pause mode — structurally supportive for carry and USD yield premium.`
    : dominant === 'DOVISH_DOMINANT'
    ? `${dovish} of ${total} tracked central banks are in cutting or dovish mode — carry headwinds building, bond accumulation favored.`
    : `Central bank policy is mixed across ${total} tracked banks — no dominant policy cycle signal.`;

  return {
    dominant,
    hawkishCount: hawkish,
    dovishCount:  dovish,
    neutralCount: neutral,
    totalBanks:   total,
    summary,
  };
}

/**
 * Enriches a carry differential pair with CB cycle context.
 * Adds: base_cycle, quote_cycle, policy_divergence_label, carry_conviction
 *
 * @param {Object} carryPair  — from ratesData.pairs
 * @param {Object} profiles   — from buildCbCycleProfiles()
 * @returns {Object} enriched pair
 */
export function enrichCarryPairWithCycle(carryPair, profiles) {
  const baseCycle  = profiles[carryPair.base_bank]  ?? null;
  const quoteCycle = profiles[carryPair.quote_bank] ?? null;

  // Policy divergence: base hawkish + quote dovish → strong carry conviction
  const basePolicyScore  = baseCycle?.stanceScore  ?? 0;
  const quotePolicyScore = quoteCycle?.stanceScore ?? 0;
  const divergenceScore  = basePolicyScore - quotePolicyScore;

  let carryConviction = 'NEUTRAL';
  let policyDivergenceLabel = 'Policy cycle aligned';

  if (divergenceScore >= 4) {
    carryConviction = 'STRONG_LONG_BASE';
    policyDivergenceLabel = `${carryPair.base_bank} hawkish vs ${carryPair.quote_bank} dovish — strong carry long`;
  } else if (divergenceScore >= 2) {
    carryConviction = 'MODERATE_LONG_BASE';
    policyDivergenceLabel = `${carryPair.base_bank} more restrictive — moderate carry advantage`;
  } else if (divergenceScore <= -4) {
    carryConviction = 'STRONG_SHORT_BASE';
    policyDivergenceLabel = `${carryPair.base_bank} dovish vs ${carryPair.quote_bank} hawkish — carry short base`;
  } else if (divergenceScore <= -2) {
    carryConviction = 'MODERATE_SHORT_BASE';
    policyDivergenceLabel = `${carryPair.quote_bank} more restrictive — moderate carry disadvantage`;
  } else {
    policyDivergenceLabel = 'Policy cycles broadly aligned — limited structural carry edge';
  }

  return {
    ...carryPair,
    base_cycle:               baseCycle  ? { type: baseCycle.cycleType,  maturity: baseCycle.maturity }  : null,
    quote_cycle:              quoteCycle ? { type: quoteCycle.cycleType, maturity: quoteCycle.maturity } : null,
    policy_divergence_score:  divergenceScore,
    policy_divergence_label:  policyDivergenceLabel,
    carry_conviction:         carryConviction,
  };
}
