/**
 * CryptoIntelligencePanel.jsx
 *
 * Institutional Cryptocurrency Intelligence Dashboard.
 * NOT a retail crypto casino. This is a professional institutional crypto regime
 * analysis layer — driven by COT positioning, macro conditions, and regime signals.
 *
 * Data sources:
 *   - CFTC COT Combined report (BTC/ETH positioning, if uploaded)
 *   - Macro regime (riskRegime) — risk-on vs risk-off
 *   - Macro signal (macroSignal) — USD bias (inverse BTC relationship)
 *   - VIX (sharedLiveVix) — volatility regime
 *   - Agent consensus (agentConsensus.agents.cryptoFlow)
 *
 * Props:
 *   riskRegime       — from computeRiskRegime()
 *   macroSignal      — from useMacroSignal()
 *   combinedData     — from parseTiffCombined() (BTC/ETH COT data)
 *   sharedLiveVix    — live VIX
 *   agentConsensus   — from useAgentConsensus()
 *   darkMode         — boolean
 *   T                — theme tokens from buildTheme()
 *   isMobile         — boolean
 */

import { useState } from 'react';
import { Label, Chip, SignalRow, VerdictCard } from './ui/InstitutionalMicro';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const USD_BIAS_NUM = {
  USD_STRONG: 2, USD_LEANING_STRONG: 1,
  NEUTRAL: 0, USD_LEANING_WEAK: -1, USD_WEAK: -2,
};

function MetricCard({ label, value, sub, color, T, mono = true }) {
  return (
    <div style={{
      background: color + '08',
      border: `1px solid ${color}28`,
      borderRadius: 8, padding: '12px 14px',
      textAlign: 'center',
    }}>
      <Label T={T}>{label}</Label>
      <div style={{
        fontSize: 22, fontWeight: 800,
        fontFamily: mono ? 'monospace' : 'inherit',
        color, marginTop: 6, letterSpacing: mono ? '-0.02em' : 0,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: T.sub, marginTop: 3 }}>{sub}</div>
      )}
    </div>
  );
}

// ─── BTC/DXY RELATIONSHIP WIDGET ────────────────────────────────────────────

function BtcDxyWidget({ usdBiasNum, usdBias, T }) {
  const labels = {
    2:  { btc: 'HEADWIND', dxy: 'BULLISH', btcColor: '#ef4444', dxyColor: '#22c55e', desc: 'Strong USD suppresses BTC bid — reduce crypto exposure' },
    1:  { btc: 'CAUTIOUS', dxy: 'LEANING↑', btcColor: '#f59e0b', dxyColor: '#f59e0b', desc: 'USD strengthening — crypto backdrop mixed' },
    0:  { btc: 'NEUTRAL',  dxy: 'NEUTRAL',  btcColor: '#8491a8', dxyColor: '#8491a8', desc: 'No clear USD directional edge — range-bound crypto likely' },
    '-1':{ btc: 'SUPPORT',  dxy: 'LEANING↓', btcColor: '#f59e0b', dxyColor: '#f59e0b', desc: 'USD softening — mild tailwind for risk assets and BTC' },
    '-2':{ btc: 'TAILWIND', dxy: 'BEARISH',  btcColor: '#22c55e', dxyColor: '#ef4444', desc: 'USD weakness historically strong positive signal for BTC' },
  };
  const cfg = labels[String(usdBiasNum)] || labels['0'];

  return (
    <div style={{
      display: 'flex', gap: 0, border: `1px solid ${T.border}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        flex: 1, padding: '12px 14px', textAlign: 'center',
        background: cfg.dxyColor + '10',
        borderRight: `1px solid ${T.border}`,
      }}>
        <Label T={T}>USD / DXY</Label>
        <div style={{ fontSize: 14, fontWeight: 800, color: cfg.dxyColor, marginTop: 6 }}>
          {cfg.dxy}
        </div>
        <div style={{ fontSize: 9, color: T.sub, marginTop: 2 }}>
          {(usdBias || 'NEUTRAL').replace(/_/g, ' ')}
        </div>
      </div>
      <div style={{
        flex: 1, padding: '12px 14px', textAlign: 'center',
        background: cfg.btcColor + '10',
      }}>
        <Label T={T}>BTC Outlook</Label>
        <div style={{ fontSize: 14, fontWeight: 800, color: cfg.btcColor, marginTop: 6 }}>
          {cfg.btc}
        </div>
        <div style={{ fontSize: 9, color: T.sub, marginTop: 2 }}>
          macro context
        </div>
      </div>
    </div>
  );
}

// ─── COT POSITIONING WIDGET ─────────────────────────────────────────────────

function CotPositioningWidget({ combinedData, T }) {
  const btcRaw = combinedData?.byAsset?.['BITCOIN'] || combinedData?.byAsset?.['BTC'];
  const ethRaw = combinedData?.byAsset?.['ETHEREUM'] || combinedData?.byAsset?.['ETH'];

  if (!btcRaw && !ethRaw) {
    return (
      <div style={{
        padding: '16px', border: `1px dashed ${T.border}`,
        borderRadius: 8, textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>
          BTC / ETH institutional positioning not available
        </div>
        <div style={{ fontSize: 11, color: T.sub2, lineHeight: 1.6 }}>
          Upload CFTC TFF Combined report to unlock institutional crypto positioning data from CFTC regulated futures markets.
        </div>
      </div>
    );
  }

  const formatNet = (n) => {
    if (n == null) return '—';
    const abs = Math.abs(n);
    return (n > 0 ? '+' : '') + (abs >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toString());
  };

  const assets = [
    btcRaw && { name: 'BITCOIN', asset: btcRaw },
    ethRaw && { name: 'ETHEREUM', asset: ethRaw },
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {assets.map(({ name, asset }) => {
        const net = asset.latest?.smartNet ?? asset.latest?.ncNet ?? null;
        const netColor = net == null ? T.sub : net > 0 ? '#22c55e' : '#ef4444';
        const longCon  = asset.latest?.levLong ?? asset.latest?.ncLong;
        const shortCon = asset.latest?.levShort ?? asset.latest?.ncShort;

        return (
          <div key={name} style={{
            background: netColor + '08',
            border: `1px solid ${netColor}33`,
            borderRadius: 8, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Label T={T}>{name} · COT Positioning</Label>
              <span style={{ fontSize: 9, color: T.sub2 }}>CFTC Regulated Futures</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 9, color: T.sub }}>NET POSITION</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: netColor }}>
                  {formatNet(net)}
                </div>
              </div>
              {longCon != null && (
                <div>
                  <div style={{ fontSize: 9, color: T.sub }}>LONGS</div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#22c55e' }}>
                    {formatNet(longCon)}
                  </div>
                </div>
              )}
              {shortCon != null && (
                <div>
                  <div style={{ fontSize: 9, color: T.sub }}>SHORTS</div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#ef4444' }}>
                    {formatNet(shortCon)}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── REGIME MATRIX ──────────────────────────────────────────────────────────

function RegimeMatrix({ regime, vix, cryptoAgent, T }) {
  const REGIME_CRYPTO_IMPACT = {
    RISK_ON:          { label: 'POSITIVE',  color: '#22c55e', desc: 'Institutional risk appetite supports crypto beta' },
    RISK_OFF:         { label: 'NEGATIVE',  color: '#ef4444', desc: 'Flight to safety — crypto typically underperforms' },
    STAGFLATION:      { label: 'MIXED',     color: '#f59e0b', desc: 'BTC as inflation hedge vs. liquidity pressure — conflicted' },
    DISINFLATION:     { label: 'CAUTIOUS',  color: '#f97316', desc: 'BTC inflation narrative fades — de-rating risk' },
    LIQUIDITY_STRESS: { label: 'EXTREME RISK', color: '#dc2626', desc: 'Crypto most vulnerable in liquidity squeeze — avoid' },
    TRANSITIONAL:     { label: 'UNCLEAR',   color: '#8491a8', desc: 'Mixed regime — no clear institutional crypto edge' },
  };

  const impact = REGIME_CRYPTO_IMPACT[regime] || REGIME_CRYPTO_IMPACT.TRANSITIONAL;
  const vixLabel = !vix ? '—'
    : vix > 30 ? 'EXTREME FEAR' : vix > 25 ? 'ELEVATED' : vix > 20 ? 'CAUTIOUS' : vix < 13 ? 'COMPLACENCY' : 'NORMAL';
  const vixColor = !vix ? T.sub : vix > 30 ? '#dc2626' : vix > 25 ? '#ef4444' : vix > 20 ? '#f59e0b' : vix < 13 ? '#f97316' : '#22c55e';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Macro regime row */}
      <div style={{
        display: 'flex', gap: 8,
      }}>
        <div style={{
          flex: 2, background: impact.color + '08',
          border: `1px solid ${impact.color}33`,
          borderRadius: 8, padding: '12px 14px',
        }}>
          <Label T={T}>Macro Regime → Crypto Impact</Label>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: impact.color }}>{impact.label}</span>
            <span style={{ fontSize: 10, color: T.sub }}>{impact.desc}</span>
          </div>
        </div>
        <div style={{
          flex: 1, background: vixColor + '08',
          border: `1px solid ${vixColor}33`,
          borderRadius: 8, padding: '12px 14px', textAlign: 'center',
        }}>
          <Label T={T}>VIX Regime</Label>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: vixColor, marginTop: 6 }}>
            {vix ? vix.toFixed(0) : '—'}
          </div>
          <div style={{ fontSize: 9, color: T.sub, marginTop: 2 }}>{vixLabel}</div>
        </div>
      </div>

      {/* Crypto regime score */}
      {cryptoAgent && (
        <div style={{
          background: T.card2,
          border: `1px solid ${T.border}`,
          borderRadius: 8, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label T={T}>Crypto Agent Score</Label>
            <Chip label={cryptoAgent.cryptoRegime?.replace('_', '-') || 'NEUTRAL'} color={cryptoAgent.regimeColor || T.sub} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
            <span style={{
              fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
              color: cryptoAgent.regimeColor || T.sub,
            }}>
              {cryptoAgent.score}
            </span>
            <span style={{ fontSize: 10, color: T.sub }}>/100</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: T.border, overflow: 'hidden', marginTop: 6 }}>
            <div style={{
              height: '100%', width: `${cryptoAgent.score}%`,
              background: cryptoAgent.regimeColor || T.sub,
              borderRadius: 2, transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── INSTITUTIONAL ASSESSMENT (4 KEY QUESTIONS) ───────────────────────────────

function InstitutionalAssessment({ regime, usdBiasNum, cryptoAgent, vix, isMobile, T }) {
  const score     = cryptoAgent?.score ?? null;
  const hasAgent  = score !== null;
  const vixHigh   = vix != null && vix > 25;
  const vixExtreme = vix != null && vix > 30;
  const usdHeadwind = usdBiasNum >= 1;
  const usdTailwind = usdBiasNum <= -1;

  // ── Q1: Is crypto aligned with the broader macro regime? ──
  let v1Answer, v1Detail, v1Color;
  if (!hasAgent) {
    v1Answer = 'INSUFFICIENT DATA';
    v1Detail = 'Agent data required — upload COT data or await regime population.';
    v1Color  = '#8491a8';
  } else if (regime === 'LIQUIDITY_STRESS') {
    v1Answer = 'ADVERSE REGIME';
    v1Detail = 'Liquidity stress is structurally bearish for all risk assets including crypto.';
    v1Color  = '#dc2626';
  } else if (regime === 'RISK_ON') {
    if (score >= 60) {
      v1Answer = 'ALIGNED — BULLISH';
      v1Detail = `Risk-on regime corroborated by crypto agent (${score}/100). Institutional flows coherent.`;
      v1Color  = '#22c55e';
    } else if (score >= 40) {
      v1Answer = 'PARTIAL ALIGNMENT';
      v1Detail = `Macro is bullish but crypto agent only ${score}/100. BTC not fully pricing risk-on conditions.`;
      v1Color  = '#f59e0b';
    } else {
      v1Answer = 'OPPOSED';
      v1Detail = `Risk-on macro but crypto agent bearish (${score}/100). Structural divergence — treat with caution.`;
      v1Color  = '#ef4444';
    }
  } else if (regime === 'RISK_OFF') {
    if (score <= 40) {
      v1Answer = 'ALIGNED — BEARISH';
      v1Detail = `Risk-off regime confirmed by weak crypto agent (${score}/100). Institutional flows coherent.`;
      v1Color  = '#ef4444';
    } else if (score <= 55) {
      v1Answer = 'PARTIAL ALIGNMENT';
      v1Detail = `Macro bearish but crypto agent neutral (${score}/100). BTC showing relative resilience.`;
      v1Color  = '#f59e0b';
    } else {
      v1Answer = 'OPPOSED';
      v1Detail = `Risk-off macro but crypto agent elevated (${score}/100). Possible idiosyncratic BTC demand or delayed repricing.`;
      v1Color  = '#f59e0b';
    }
  } else {
    v1Answer = 'MIXED';
    v1Detail = `Regime (${regime.replace(/_/g, ' ')}) provides no dominant directional crypto edge.`;
    v1Color  = '#8491a8';
  }

  // ── Q2: Is BTC leading or lagging? ──
  let v2Answer, v2Detail, v2Color;
  if (!hasAgent) {
    v2Answer = 'NO DATA';
    v2Detail = 'Agent score required to assess BTC relative performance vs. macro.';
    v2Color  = '#8491a8';
  } else if (regime === 'RISK_ON') {
    if (score >= 70) {
      v2Answer = 'LEADING RISK-ON';
      v2Detail = `Crypto agent at ${score}/100 outpaces macro — BTC frontrunning institutions. Watch for exhaustion.`;
      v2Color  = '#f59e0b';
    } else if (score >= 50) {
      v2Answer = 'IN-LINE';
      v2Detail = `BTC tracking risk-on regime (${score}/100). Balanced institutional positioning — no divergence.`;
      v2Color  = '#22c55e';
    } else {
      v2Answer = 'LAGGING';
      v2Detail = `Macro tailwind present but BTC underperforming (${score}/100). Potential catch-up or structural weakness.`;
      v2Color  = '#f97316';
    }
  } else if (regime === 'RISK_OFF') {
    if (score <= 35) {
      v2Answer = 'LEADING SELLOFF';
      v2Detail = `BTC pricing in risk-off aggressively (${score}/100). Possible capitulation — watch for reversal setup.`;
      v2Color  = '#ef4444';
    } else if (score <= 52) {
      v2Answer = 'IN-LINE';
      v2Detail = `BTC declining with macro (${score}/100). Orderly institutional repositioning underway.`;
      v2Color  = '#f59e0b';
    } else {
      v2Answer = 'LAGGING DEFENSE';
      v2Detail = `Risk-off macro but BTC holding (${score}/100). Either acting as inflation hedge or repricing is delayed.`;
      v2Color  = '#f97316';
    }
  } else {
    v2Answer = 'INDETERMINATE';
    v2Detail = 'Transitional or mixed regime — lead/lag relationship currently inconclusive.';
    v2Color  = '#8491a8';
  }

  // ── Q3: Continuation or trap? ──
  let v3Answer, v3Detail, v3Color;
  if (!hasAgent) {
    v3Answer = 'UNRESOLVED';
    v3Detail = 'Insufficient signal data to assess continuation vs. trap probability.';
    v3Color  = '#8491a8';
  } else if (regime === 'RISK_ON' && score >= 60) {
    if (vixExtreme) {
      v3Answer = 'HIGH RISK TRAP';
      v3Detail = 'Bullish signal present but VIX extreme. Elevated whipsaw probability — reduce size.';
      v3Color  = '#ef4444';
    } else if (usdHeadwind && vixHigh) {
      v3Answer = 'POSSIBLE TRAP';
      v3Detail = 'USD headwind + elevated VIX undermine bullish setup. Macro is working against upside continuation.';
      v3Color  = '#f59e0b';
    } else if (usdTailwind && !vixHigh) {
      v3Answer = 'CONTINUATION LIKELY';
      v3Detail = 'Risk-on + strong crypto signal + USD tailwind + controlled VIX = high-quality bullish continuation.';
      v3Color  = '#22c55e';
    } else {
      v3Answer = 'PROBABLE CONTINUATION';
      v3Detail = 'Conditions broadly supportive. No significant macro contradictions detected.';
      v3Color  = '#22c55e';
    }
  } else if (regime === 'RISK_OFF' && score <= 40) {
    v3Answer = 'BEARISH CONTINUATION';
    v3Detail = vixExtreme
      ? 'Risk-off + weak crypto + extreme VIX = high-conviction bearish continuation. Capitulation risk.'
      : 'Risk-off conditions confirmed. Institutional selling likely to persist — defensive posture warranted.';
    v3Color  = '#ef4444';
  } else if (regime === 'RISK_ON' && score < 50) {
    v3Answer = 'BULL TRAP RISK';
    v3Detail = 'Macro regime bullish but crypto agent fails to confirm. Classic bull trap pattern — await alignment before entry.';
    v3Color  = '#f59e0b';
  } else if (regime === 'RISK_OFF' && score > 55) {
    v3Answer = 'BEAR TRAP RISK';
    v3Detail = 'Risk-off macro but crypto agent elevated. Possible institutional accumulation beneath — bear trap in progress.';
    v3Color  = '#f59e0b';
  } else {
    v3Answer = 'MIXED SIGNALS';
    v3Detail = 'No dominant continuation or trap pattern. Regime transition or consolidation is the base case.';
    v3Color  = '#8491a8';
  }

  // ── Q4: Is timing favorable? ──
  let v4Answer, v4Detail, v4Color;
  if (regime === 'LIQUIDITY_STRESS') {
    v4Answer = 'UNFAVORABLE';
    v4Detail = 'Liquidity stress regime — worst timing for crypto entry. Capital preservation is the only priority.';
    v4Color  = '#dc2626';
  } else if (vixExtreme) {
    v4Answer = 'POOR';
    v4Detail = `VIX at ${vix.toFixed(0)} signals extreme stress. Timing risk elevated — wait for volatility to compress.`;
    v4Color  = '#ef4444';
  } else if (!hasAgent) {
    v4Answer = 'INCOMPLETE';
    v4Detail = 'Upload CFTC TFF Combined report to complete institutional timing assessment.';
    v4Color  = '#8491a8';
  } else if (regime === 'RISK_ON' && score >= 60 && !vixHigh && usdBiasNum <= 0) {
    v4Answer = 'FAVORABLE';
    v4Detail = 'Multi-factor alignment: risk-on regime + strong crypto signal + controlled volatility + neutral/weak USD.';
    v4Color  = '#22c55e';
  } else if (regime === 'RISK_OFF') {
    v4Answer = 'UNFAVORABLE';
    v4Detail = 'Risk-off conditions not conducive to long crypto exposure. Await regime reversal confirmation.';
    v4Color  = '#ef4444';
  } else if (vixHigh || (usdHeadwind && score < 65)) {
    v4Answer = 'ADVERSE';
    v4Detail = 'Elevated volatility or USD headwind reduces timing quality. Smaller size or wait for cleaner setup.';
    v4Color  = '#f59e0b';
  } else {
    v4Answer = 'MIXED';
    v4Detail = 'Some conditions supportive, others uncertain. Selective positioning with reduced conviction.';
    v4Color  = '#f59e0b';
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 8,
    }}>
      <VerdictCard question="IS CRYPTO REGIME ALIGNED?" answer={v1Answer} detail={v1Detail} color={v1Color} T={T} />
      <VerdictCard question="IS BTC LEADING OR LAGGING?"  answer={v2Answer} detail={v2Detail} color={v2Color} T={T} />
      <VerdictCard question="CONTINUATION OR TRAP?"        answer={v3Answer} detail={v3Detail} color={v3Color} T={T} />
      <VerdictCard question="IS TIMING FAVORABLE?"         answer={v4Answer} detail={v4Detail} color={v4Color} T={T} />
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function CryptoIntelligencePanel({
  riskRegime,
  macroSignal,
  combinedData,
  sharedLiveVix,
  agentConsensus,
  T,
  isMobile,
}) {
  const [showMethodology, setShowMethodology] = useState(false);

  const regime     = riskRegime?.regime || 'TRANSITIONAL';
  const usdBias    = macroSignal?.bias  || 'NEUTRAL';
  const usdBiasNum = USD_BIAS_NUM[usdBias] ?? 0;
  const cryptoAgent = agentConsensus?.agents?.cryptoFlow;
  const vix         = sharedLiveVix;

  const signals = cryptoAgent?.signals || [];
  const warnings = cryptoAgent?.warnings || [];

  const ENV_COLORS = {
    RISK_ON:          { color: '#22c55e', bg: 'rgba(34,197,94,0.06)'  },
    RISK_OFF:         { color: '#ef4444', bg: 'rgba(239,68,68,0.06)'  },
    STAGFLATION:      { color: '#f97316', bg: 'rgba(249,115,22,0.06)' },
    DISINFLATION:     { color: '#60a5fa', bg: 'rgba(96,165,250,0.06)' },
    LIQUIDITY_STRESS: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)'  },
    TRANSITIONAL:     { color: '#8491a8', bg: 'rgba(132,145,168,0.06)'},
  };
  const regimeCfg = ENV_COLORS[regime] || ENV_COLORS.TRANSITIONAL;

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto',
      padding: isMobile ? '12px 10px' : '24px 20px',
      fontFamily: "'Inter','SF Pro Text',Helvetica,sans-serif",
    }}>

      {/* ── HEADER ── */}
      <div style={{
        background: T.card,
        border: `1px solid ${regimeCfg.color}44`,
        borderRadius: 12,
        padding: isMobile ? '16px' : '20px 24px',
        marginBottom: 16,
        boxShadow: `0 0 0 1px ${regimeCfg.color}15, 0 4px 24px rgba(0,0,0,0.12)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: regimeCfg.color, boxShadow: `0 0 8px ${regimeCfg.color}`,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.1em' }}>
              CRYPTO INTELLIGENCE · INSTITUTIONAL VIEW
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {combinedData && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: T.green,
                background: T.green + '15', border: `1px solid ${T.green}33`,
                padding: '2px 8px', borderRadius: 99,
              }}>
                COT DATA ACTIVE
              </span>
            )}
            <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em' }}>
              {regime.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Regime banner */}
        <div style={{
          padding: '12px 16px',
          background: regimeCfg.bg,
          border: `1px solid ${regimeCfg.color}33`,
          borderRadius: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: regimeCfg.color, letterSpacing: '0.04em' }}>
              {regime.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>
              {riskRegime?.description?.slice(0, 140) || 'Macro regime data loading...'}
            </span>
          </div>
        </div>
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 12, marginBottom: 16,
      }}>
        {/* Left: BTC/DXY + Regime Matrix */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ marginBottom: 12 }}>
              <Label T={T}>BTC / DXY Macro Relationship</Label>
            </div>
            <BtcDxyWidget usdBiasNum={usdBiasNum} usdBias={usdBias} T={T} />
            <p style={{ margin: '10px 0 0', fontSize: 11, color: T.sub, lineHeight: 1.6 }}>
              {usdBiasNum <= -1
                ? 'USD weakness reduces the opportunity cost of holding non-yielding assets like BTC. Risk appetite broadly supported.'
                : usdBiasNum >= 1
                ? 'USD strength draws capital into dollar-denominated instruments. BTC faces headwind from reduced risk appetite.'
                : 'USD neutral — no strong directional macro tailwind or headwind for crypto. Technical factors dominant.'}
            </p>
          </div>

          <div style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ marginBottom: 12 }}>
              <Label T={T}>Regime Impact Analysis</Label>
            </div>
            <RegimeMatrix regime={regime} vix={vix} cryptoAgent={cryptoAgent} T={T} />
          </div>
        </div>

        {/* Right: COT Positioning + Signals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ marginBottom: 12 }}>
              <Label T={T}>Institutional COT Positioning</Label>
              <span style={{ fontSize: 9, color: T.sub2, marginLeft: 6 }}>CFTC · Leveraged Money</span>
            </div>
            <CotPositioningWidget combinedData={combinedData} T={T} />
          </div>

          {/* Signals + Warnings */}
          <div style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '16px 18px',
            flex: 1,
          }}>
            <div style={{ marginBottom: 12 }}>
              <Label T={T}>Crypto Signals</Label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {signals.map((s, i) => (
                <SignalRow key={i} icon="◆" text={s} color={T.cyan} T={T} />
              ))}
              {warnings.map((w, i) => (
                <SignalRow key={`w${i}`} icon="⚠" text={w} color={T.amber} T={T} />
              ))}
              {!signals.length && !warnings.length && (
                <p style={{ fontSize: 12, color: T.sub, margin: 0 }}>
                  Signals will populate as regime data loads.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── INSTITUTIONAL ASSESSMENT — 4 KEY QUESTIONS ── */}
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        marginBottom: 16,
      }}>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Label T={T}>Institutional Assessment</Label>
          <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em' }}>4 KEY QUESTIONS</span>
        </div>
        <InstitutionalAssessment
          regime={regime}
          usdBiasNum={usdBiasNum}
          cryptoAgent={cryptoAgent}
          vix={vix}
          isMobile={isMobile}
          T={T}
        />
      </div>

      {/* ── INSTITUTIONAL CONTEXT ── */}
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: isMobile ? '14px' : '18px 20px',
        marginBottom: 16,
      }}>
        <div style={{ marginBottom: 12 }}>
          <Label T={T}>Institutional Crypto Context</Label>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
          gap: 8,
        }}>
          {[
            {
              label: 'BTC/USD Macro',
              value: usdBiasNum <= -1 ? 'TAILWIND' : usdBiasNum >= 1 ? 'HEADWIND' : 'NEUTRAL',
              color: usdBiasNum <= -1 ? T.green : usdBiasNum >= 1 ? T.red : T.sub,
            },
            {
              label: 'Volatility',
              value: !vix ? '—' : vix > 25 ? 'HIGH' : vix > 18 ? 'ELEVATED' : 'LOW',
              color: !vix ? T.sub : vix > 25 ? T.red : vix > 18 ? T.amber : T.green,
              sub: vix ? `VIX ${vix.toFixed(1)}` : null,
            },
            {
              label: 'Risk Regime',
              value: regime === 'RISK_ON' ? 'FAVORABLE' : regime === 'RISK_OFF' ? 'ADVERSE' : 'MIXED',
              color: regime === 'RISK_ON' ? T.green : regime === 'RISK_OFF' ? T.red : T.amber,
            },
            {
              label: 'COT Data',
              value: combinedData ? 'ACTIVE' : 'MISSING',
              color: combinedData ? T.green : T.sub,
              sub: combinedData ? 'Upload verified' : 'Upload TFF Combined',
            },
          ].map(({ label, value, color, sub }) => (
            <MetricCard key={label} label={label} value={value} sub={sub} color={color} T={T} mono={false} />
          ))}
        </div>
      </div>

      {/* ── METHODOLOGY NOTE ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 4,
      }}>
        <span style={{ fontSize: 9, color: T.sub2, letterSpacing: '0.06em' }}>
          COT TRACKER · INSTITUTIONAL CRYPTO · CFTC + MACRO + REGIME SYNTHESIS
        </span>
        <button
          onClick={() => setShowMethodology(m => !m)}
          style={{
            fontSize: 9, color: T.sub, background: 'none', border: 'none',
            cursor: 'pointer', textDecoration: 'underline', padding: 0,
          }}
        >
          {showMethodology ? 'Hide' : 'Methodology'}
        </button>
      </div>

      {showMethodology && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: T.card2, border: `1px solid ${T.border}`,
          borderRadius: 8, fontSize: 11, color: T.sub, lineHeight: 1.7,
        }}>
          <strong style={{ color: T.txt }}>Crypto Intelligence Methodology:</strong> This panel synthesizes three
          independent signal sources: (1) CFTC regulated futures positioning for BTC and ETH — the only
          institutional-grade positioning data available for crypto; (2) USD macro bias derived from G4 yield
          spread analysis — BTC historically exhibits a strong inverse correlation with DXY strength; (3) The
          prevailing multi-asset macro regime derived from cross-asset COT positioning, which determines whether
          institutional capital broadly favors risk-on or risk-off positioning. This is <em>not</em> on-chain
          analysis — it is macro-structural institutional flow analysis applied to the crypto asset class.
        </div>
      )}
    </div>
  );
}
