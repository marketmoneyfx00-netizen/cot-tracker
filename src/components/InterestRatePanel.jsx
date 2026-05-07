/**
 * InterestRatePanel.jsx
 *
 * Panel de decisiones de tipos de interés — 7 bancos centrales.
 * Diseño basado en terminal institucional: sidebar selector + gráfico + tabla.
 *
 * Integración: primer bloque dentro de MacroTab.jsx, hereda el mismo
 * contenedor (maxWidth 1500, padding 24px 32px) para consistencia visual.
 *
 * Props:
 *   darkMode  — boolean
 *   T         — buildTheme(darkMode) del sistema
 *   isMobile  — boolean
 */

import { useState, useRef, useEffect } from 'react';

// ─── DATOS ────────────────────────────────────────────────────────────────────
// Historial real aproximado de cada banco central (fecha, tasa en %)
const BANKS = [
  {
    id: 'FED', name: 'FED – Federal Reserve', country: 'US', flag: '🇺🇸', flagCode: 'us', ccy: 'USD',
    desc: 'Decisión de tipos de interés',
    current: 4.50, previous: 4.75, consensus: 4.50, surprise: 0.00,
    nextMeeting: '18 jun 2025',
    signal: { label: 'RESTRICTIVO', color: '#ef4444', desc: 'Política monetaria restrictiva' },
    history: [
      { d: '2015-12', r: 0.50 }, { d: '2016-12', r: 0.75 }, { d: '2017-03', r: 1.00 },
      { d: '2017-06', r: 1.25 }, { d: '2017-12', r: 1.50 }, { d: '2018-03', r: 1.75 },
      { d: '2018-06', r: 2.00 }, { d: '2018-09', r: 2.25 }, { d: '2018-12', r: 2.50 },
      { d: '2019-08', r: 2.25 }, { d: '2019-09', r: 2.00 }, { d: '2019-10', r: 1.75 },
      { d: '2020-03', r: 0.25 }, { d: '2021-12', r: 0.25 }, { d: '2022-03', r: 0.50 },
      { d: '2022-05', r: 1.00 }, { d: '2022-06', r: 1.75 }, { d: '2022-07', r: 2.50 },
      { d: '2022-09', r: 3.25 }, { d: '2022-11', r: 4.00 }, { d: '2022-12', r: 4.50 },
      { d: '2023-02', r: 4.75 }, { d: '2023-03', r: 5.00 }, { d: '2023-05', r: 5.25 },
      { d: '2023-07', r: 5.50 }, { d: '2024-09', r: 5.25 }, { d: '2024-11', r: 4.75 },
      { d: '2024-12', r: 4.50 }, { d: '2025-01', r: 4.50 }, { d: '2025-03', r: 4.50 },
      { d: '2025-05', r: 4.50 },
    ],
    decisions: [
      { date: '07 may 2025', rate: '4.50%', prev: '4.75%', cons: '4.50%', surp: '0.00%', decision: 'Sin cambios',  impact: 3 },
      { date: '20 mar 2025', rate: '4.75%', prev: '5.00%', cons: '4.75%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '29 ene 2025', rate: '5.00%', prev: '5.00%', cons: '5.00%', surp: '0.00%', decision: 'Sin cambios',  impact: 3 },
      { date: '18 dic 2024', rate: '4.75%', prev: '4.50%', cons: '4.50%', surp: '+0.25%', decision: 'Subida 25 pb',  impact: 3, bull: true },
      { date: '07 nov 2024', rate: '4.50%', prev: '4.75%', cons: '4.50%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
    ],
  },
  {
    id: 'BCE', name: 'BCE – Banco Central Europeo', country: 'EU', flag: '🇪🇺', flagCode: 'eu', ccy: 'EUR',
    desc: 'Tipos de refinanciación principales',
    current: 2.40, previous: 2.65, consensus: 2.40, surprise: 0.00,
    nextMeeting: '05 jun 2025',
    signal: { label: 'ACOMODATICIO', color: '#22c55e', desc: 'Ciclo de recortes en marcha' },
    history: [
      { d: '2015-01', r: 0.05 }, { d: '2016-03', r: 0.00 }, { d: '2019-09', r: 0.00 },
      { d: '2021-12', r: 0.00 }, { d: '2022-07', r: 0.50 }, { d: '2022-09', r: 1.25 },
      { d: '2022-10', r: 2.00 }, { d: '2022-12', r: 2.50 }, { d: '2023-02', r: 3.00 },
      { d: '2023-03', r: 3.50 }, { d: '2023-05', r: 3.75 }, { d: '2023-06', r: 4.00 },
      { d: '2023-07', r: 4.25 }, { d: '2023-09', r: 4.50 }, { d: '2024-06', r: 4.25 },
      { d: '2024-09', r: 3.65 }, { d: '2024-10', r: 3.40 }, { d: '2024-12', r: 3.15 },
      { d: '2025-01', r: 2.90 }, { d: '2025-03', r: 2.65 }, { d: '2025-04', r: 2.40 },
    ],
    decisions: [
      { date: '17 abr 2025', rate: '2.40%', prev: '2.65%', cons: '2.40%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '06 mar 2025', rate: '2.65%', prev: '2.90%', cons: '2.65%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '30 ene 2025', rate: '2.90%', prev: '3.15%', cons: '2.90%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '12 dic 2024', rate: '3.15%', prev: '3.40%', cons: '3.15%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '17 oct 2024', rate: '3.40%', prev: '3.65%', cons: '3.40%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
    ],
  },
  {
    id: 'BOE', name: 'BOE – Bank of England', country: 'GB', flag: '🇬🇧', flagCode: 'gb', ccy: 'GBP',
    desc: 'Tipo de interés oficial bancario',
    current: 4.50, previous: 4.75, consensus: 4.50, surprise: 0.00,
    nextMeeting: '19 jun 2025',
    signal: { label: 'NEUTRO', color: '#f59e0b', desc: 'Reducción gradual con cautela' },
    history: [
      { d: '2015-01', r: 0.50 }, { d: '2016-08', r: 0.25 }, { d: '2017-11', r: 0.50 },
      { d: '2018-08', r: 0.75 }, { d: '2020-03', r: 0.10 }, { d: '2021-12', r: 0.25 },
      { d: '2022-02', r: 0.50 }, { d: '2022-03', r: 0.75 }, { d: '2022-05', r: 1.00 },
      { d: '2022-06', r: 1.25 }, { d: '2022-08', r: 1.75 }, { d: '2022-09', r: 2.25 },
      { d: '2022-11', r: 3.00 }, { d: '2022-12', r: 3.50 }, { d: '2023-02', r: 4.00 },
      { d: '2023-03', r: 4.25 }, { d: '2023-05', r: 4.50 }, { d: '2023-06', r: 5.00 },
      { d: '2023-08', r: 5.25 }, { d: '2024-08', r: 5.00 }, { d: '2024-11', r: 4.75 },
      { d: '2025-02', r: 4.50 },
    ],
    decisions: [
      { date: '06 feb 2025', rate: '4.50%', prev: '4.75%', cons: '4.50%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '19 dic 2024', rate: '4.75%', prev: '5.00%', cons: '4.75%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '07 nov 2024', rate: '5.00%', prev: '5.25%', cons: '5.00%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '01 ago 2024', rate: '5.25%', prev: '5.25%', cons: '5.00%', surp: '+0.25%', decision: 'Sin cambios',  impact: 3 },
      { date: '20 jun 2024', rate: '5.25%', prev: '5.25%', cons: '5.25%', surp: '0.00%', decision: 'Sin cambios',  impact: 3 },
    ],
  },
  {
    id: 'BOJ', name: 'BOJ – Bank of Japan', country: 'JP', flag: '🇯🇵', flagCode: 'jp', ccy: 'JPY',
    desc: 'Tipo de interés objetivo a un día',
    current: 0.50, previous: 0.25, consensus: 0.50, surprise: 0.00,
    nextMeeting: '17 jun 2025',
    signal: { label: 'RESTRICTIVO', color: '#ef4444', desc: 'Normalización monetaria gradual' },
    history: [
      { d: '2015-01', r: 0.10 }, { d: '2016-01', r: -0.10 }, { d: '2019-12', r: -0.10 },
      { d: '2022-12', r: -0.10 }, { d: '2023-12', r: -0.10 }, { d: '2024-03', r: 0.10 },
      { d: '2024-07', r: 0.25 }, { d: '2025-01', r: 0.50 },
    ],
    decisions: [
      { date: '24 ene 2025', rate: '0.50%', prev: '0.25%', cons: '0.25%', surp: '+0.25%', decision: 'Subida 25 pb', impact: 3, bull: true },
      { date: '31 jul 2024', rate: '0.25%', prev: '0.10%', cons: '0.10%', surp: '+0.15%', decision: 'Subida 15 pb', impact: 3, bull: true },
      { date: '19 mar 2024', rate: '0.10%', prev: '-0.10%', cons: '0.00%', surp: '+0.10%', decision: 'Fin de tipos neg.', impact: 3, bull: true },
      { date: '19 dic 2023', rate: '-0.10%', prev: '-0.10%', cons: '-0.10%', surp: '0.00%', decision: 'Sin cambios', impact: 2 },
      { date: '27 oct 2023', rate: '-0.10%', prev: '-0.10%', cons: '-0.10%', surp: '0.00%', decision: 'Sin cambios', impact: 2 },
    ],
  },
  {
    id: 'SNB', name: 'SNB – Swiss National Bank', country: 'CH', flag: '🇨🇭', flagCode: 'ch', ccy: 'CHF',
    desc: 'Tipo de interés de referencia SNB',
    current: 0.25, previous: 0.50, consensus: 0.25, surprise: 0.00,
    nextMeeting: '19 jun 2025',
    signal: { label: 'ACOMODATICIO', color: '#22c55e', desc: 'Ciclo de recortes agresivo' },
    history: [
      { d: '2015-01', r: -0.75 }, { d: '2019-12', r: -0.75 }, { d: '2022-06', r: -0.25 },
      { d: '2022-09', r: 0.50 }, { d: '2022-12', r: 1.00 }, { d: '2023-03', r: 1.50 },
      { d: '2024-03', r: 1.25 }, { d: '2024-06', r: 1.00 }, { d: '2024-09', r: 0.75 },
      { d: '2024-12', r: 0.50 }, { d: '2025-03', r: 0.25 },
    ],
    decisions: [
      { date: '20 mar 2025', rate: '0.25%', prev: '0.50%', cons: '0.25%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '12 dic 2024', rate: '0.50%', prev: '0.75%', cons: '0.75%', surp: '-0.25%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '26 sep 2024', rate: '0.75%', prev: '1.00%', cons: '1.00%', surp: '-0.25%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '20 jun 2024', rate: '1.00%', prev: '1.25%', cons: '1.25%', surp: '-0.25%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '21 mar 2024', rate: '1.25%', prev: '1.50%', cons: '1.50%', surp: '-0.25%', decision: 'Recorte 25 pb', impact: 3, bear: true },
    ],
  },
  {
    id: 'RBA', name: 'RBA – Reserve Bank of Australia', country: 'AU', flag: '🇦🇺', flagCode: 'au', ccy: 'AUD',
    desc: 'Tipo de interés oficial al contado',
    current: 4.10, previous: 4.35, consensus: 4.10, surprise: 0.00,
    nextMeeting: '01 jul 2025',
    signal: { label: 'NEUTRO', color: '#f59e0b', desc: 'Primer recorte — ciclo incierto' },
    history: [
      { d: '2015-02', r: 2.25 }, { d: '2016-05', r: 1.75 }, { d: '2016-08', r: 1.50 },
      { d: '2019-06', r: 1.25 }, { d: '2019-07', r: 1.00 }, { d: '2019-10', r: 0.75 },
      { d: '2020-03', r: 0.50 }, { d: '2020-11', r: 0.10 }, { d: '2022-05', r: 0.35 },
      { d: '2022-06', r: 0.85 }, { d: '2022-07', r: 1.35 }, { d: '2022-08', r: 1.85 },
      { d: '2022-09', r: 2.35 }, { d: '2022-10', r: 2.60 }, { d: '2022-11', r: 2.85 },
      { d: '2022-12', r: 3.10 }, { d: '2023-02', r: 3.35 }, { d: '2023-03', r: 3.60 },
      { d: '2023-05', r: 3.85 }, { d: '2023-06', r: 4.10 }, { d: '2023-11', r: 4.35 },
      { d: '2025-02', r: 4.10 },
    ],
    decisions: [
      { date: '18 feb 2025', rate: '4.10%', prev: '4.35%', cons: '4.10%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '10 dic 2024', rate: '4.35%', prev: '4.35%', cons: '4.35%', surp: '0.00%', decision: 'Sin cambios', impact: 3 },
      { date: '05 nov 2024', rate: '4.35%', prev: '4.35%', cons: '4.35%', surp: '0.00%', decision: 'Sin cambios', impact: 3 },
      { date: '24 sep 2024', rate: '4.35%', prev: '4.35%', cons: '4.35%', surp: '0.00%', decision: 'Sin cambios', impact: 3 },
      { date: '06 ago 2024', rate: '4.35%', prev: '4.35%', cons: '4.35%', surp: '0.00%', decision: 'Sin cambios', impact: 3 },
    ],
  },
  {
    id: 'BOC', name: 'BOC – Bank of Canada', country: 'CA', flag: '🇨🇦', flagCode: 'ca', ccy: 'CAD',
    desc: 'Tipo de interés objetivo a un día',
    current: 2.75, previous: 3.00, consensus: 2.75, surprise: 0.00,
    nextMeeting: '04 jun 2025',
    signal: { label: 'ACOMODATICIO', color: '#22c55e', desc: 'Ciclo de recortes activo' },
    history: [
      { d: '2015-01', r: 0.75 }, { d: '2015-07', r: 0.50 }, { d: '2017-07', r: 0.75 },
      { d: '2017-09', r: 1.00 }, { d: '2018-01', r: 1.25 }, { d: '2018-07', r: 1.50 },
      { d: '2018-10', r: 1.75 }, { d: '2020-03', r: 0.25 }, { d: '2022-03', r: 0.50 },
      { d: '2022-04', r: 1.00 }, { d: '2022-06', r: 1.50 }, { d: '2022-07', r: 2.50 },
      { d: '2022-09', r: 3.25 }, { d: '2022-10', r: 3.75 }, { d: '2022-12', r: 4.25 },
      { d: '2023-01', r: 4.50 }, { d: '2023-06', r: 4.75 }, { d: '2023-07', r: 5.00 },
      { d: '2024-06', r: 4.75 }, { d: '2024-07', r: 4.50 }, { d: '2024-09', r: 4.25 },
      { d: '2024-10', r: 3.75 }, { d: '2024-12', r: 3.25 }, { d: '2025-01', r: 3.00 },
      { d: '2025-03', r: 2.75 },
    ],
    decisions: [
      { date: '12 mar 2025', rate: '2.75%', prev: '3.00%', cons: '2.75%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '29 ene 2025', rate: '3.00%', prev: '3.25%', cons: '3.00%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
      { date: '11 dic 2024', rate: '3.25%', prev: '3.75%', cons: '3.50%', surp: '-0.25%', decision: 'Recorte 50 pb', impact: 3, bear: true },
      { date: '23 oct 2024', rate: '3.75%', prev: '4.25%', cons: '4.00%', surp: '-0.25%', decision: 'Recorte 50 pb', impact: 3, bear: true },
      { date: '04 sep 2024', rate: '4.25%', prev: '4.50%', cons: '4.25%', surp: '0.00%', decision: 'Recorte 25 pb', impact: 3, bear: true },
    ],
  },
];

// ─── GRÁFICO SVG ──────────────────────────────────────────────────────────────
function RateChart({ history, color, darkMode }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  if (!history || history.length < 2) return null;

  const W = 800, H = 220;
  const PAD = { top: 16, right: 20, bottom: 36, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const rates = history.map(p => p.r);
  const rawMin = Math.min(...rates);
  const rawMax = Math.max(...rates);
  const padding = (rawMax - rawMin) * 0.12 || 0.3;
  const yMin = Math.floor((rawMin - padding) * 4) / 4;
  const yMax = Math.ceil((rawMax + padding) * 4) / 4;
  const yRange = yMax - yMin || 1;

  // Parse dates to numeric value for X positioning
  const toNum = (d) => {
    const [y, m] = d.split('-').map(Number);
    return y + (m - 1) / 12;
  };
  const xNums = history.map(p => toNum(p.d));
  const xMin = Math.min(...xNums);
  const xMax = Math.max(...xNums);
  const xRange = xMax - xMin || 1;

  const toX = (d) => PAD.left + ((toNum(d) - xMin) / xRange) * plotW;
  const toY = (r) => PAD.top + (1 - (r - yMin) / yRange) * plotH;

  const pts = history.map(p => ({ x: toX(p.d), y: toY(p.r), r: p.r, d: p.d }));
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${lineD} L ${pts[pts.length-1].x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;

  // Y axis grid lines
  const yTicks = [];
  const step = yRange <= 2 ? 0.25 : yRange <= 4 ? 0.50 : yRange <= 6 ? 1 : 2;
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 0.001; v = Math.round((v + step) * 100) / 100) {
    yTicks.push(v);
  }

  // X axis year markers
  const years = [];
  const firstYear = Math.ceil(xMin);
  const lastYear = Math.floor(xMax);
  const yearStep = (lastYear - firstYear) <= 6 ? 1 : 2;
  for (let y = firstYear; y <= lastYear; y += yearStep) {
    const xPos = PAD.left + ((y - xMin) / xRange) * plotW;
    if (xPos > PAD.left + 5 && xPos < W - PAD.right - 5) {
      years.push({ y, x: xPos });
    }
  }

  const gridColor = darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const axisColor = darkMode ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)';
  const labelColor = darkMode ? '#5a6070' : '#9ca3af';

  return (
    <svg
      ref={svgRef}
      width="100%" viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', overflow: 'visible' }}
      onMouseLeave={() => setTooltip(null)}
    >
      <defs>
        <linearGradient id={`rateGrad_${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22"/>
          <stop offset="80%"  stopColor={color} stopOpacity="0.04"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
        <clipPath id="chartClip">
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH}/>
        </clipPath>
      </defs>

      {/* Grid lines */}
      {yTicks.map((v, i) => {
        const y = toY(v);
        if (y < PAD.top - 2 || y > PAD.top + plotH + 2) return null;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y}
              stroke={gridColor} strokeWidth="1" strokeDasharray="3 4"/>
            <text x={PAD.left - 6} y={y + 4} textAnchor="end"
              fontSize={9} fill={labelColor} fontFamily="monospace">
              {v % 1 === 0 ? v.toFixed(1) : v.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* X axis year labels */}
      {years.map(({ y, x }) => (
        <g key={y}>
          <line x1={x} y1={PAD.top + plotH} x2={x} y2={PAD.top + plotH + 4}
            stroke={axisColor} strokeWidth="1"/>
          <text x={x} y={H - 4} textAnchor="middle"
            fontSize={9.5} fill={labelColor} fontFamily="monospace">
            {y}
          </text>
        </g>
      ))}

      {/* Area + line (clipped) */}
      <g clipPath="url(#chartClip)">
        <path d={areaD} fill={`url(#rateGrad_${color.replace('#','')})`}/>
        <path d={lineD} fill="none" stroke={color} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"/>
      </g>

      {/* Dots with hover areas */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} opacity={0.9}/>
          <circle cx={p.x} cy={p.y} r={10} fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setTooltip(p)}/>
        </g>
      ))}

      {/* Tooltip */}
      {tooltip && (() => {
        const tw = 80, th = 34;
        const tx = Math.min(Math.max(tooltip.x - tw/2, PAD.left), W - PAD.right - tw);
        const ty = tooltip.y - th - 8;
        const [yr, mo] = tooltip.d.split('-');
        const months = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return (
          <g>
            <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top + plotH}
              stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5"/>
            <rect x={tx} y={ty} width={tw} height={th} rx={5}
              fill={darkMode ? '#1a2230' : '#fff'}
              stroke={color} strokeWidth="1" opacity="0.96"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))' }}/>
            <text x={tx + tw/2} y={ty + 12} textAnchor="middle"
              fontSize={9} fill={darkMode ? '#8b90a0' : '#64748b'} fontFamily="monospace">
              {months[parseInt(mo)]} {yr}
            </text>
            <text x={tx + tw/2} y={ty + 26} textAnchor="middle"
              fontSize={13} fontWeight="700" fill={color} fontFamily="monospace">
              {tooltip.r >= 0 ? tooltip.r.toFixed(2) : tooltip.r.toFixed(2)}%
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function InterestRatePanel({ darkMode, T, isMobile }) {
  const [selectedId, setSelectedId] = useState('FED');
  const bank = BANKS.find(b => b.id === selectedId) || BANKS[0];

  const lastUpdated = new Date().toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) + ' – ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const surpriseColor = bank.surprise > 0 ? '#22c55e'
    : bank.surprise < 0 ? '#ef4444' : T.sub;

  return (
    <div style={{ marginBottom: 24 }}>

      {/* ── HEADER ROW ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        marginBottom: 16,
      }}>
        <div>
          <h2 style={{ margin: '0 0 3px', fontSize: isMobile ? 17 : 20, fontWeight: 700, color: T.txt, letterSpacing: '-0.3px' }}>
            Decisiones de Tipos de Interés
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: T.sub }}>
            Evolución histórica de los tipos de interés oficiales
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: T.sub2 }}>
            Última actualización: {lastUpdated}
          </span>
          <button
            onClick={() => {}}
            style={{
              background: 'transparent', border: `1px solid ${T.border}`,
              borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
              color: T.sub, fontSize: 12,
            }}
          >↻</button>
        </div>
      </div>

      {/* ── MAIN LAYOUT: sidebar + content ──────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '230px 1fr',
        gap: 16,
        alignItems: 'start',
      }}>

        {/* ── SIDEBAR: bank selector ────────────────────────────────────────── */}
        <div style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${T.border}`,
            fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.1em',
          }}>
            BANCO CENTRAL
          </div>
          {BANKS.map(b => {
            const active = b.id === selectedId;
            return (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', border: 'none', cursor: 'pointer',
                  background: active
                    ? (darkMode ? 'rgba(0,85,204,0.15)' : 'rgba(0,85,204,0.07)')
                    : 'transparent',
                  borderLeft: active ? `3px solid ${T.accent}` : '3px solid transparent',
                  borderBottom: `1px solid ${T.border}`,
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                {/* Flag circle */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: active
                    ? (darkMode ? 'rgba(0,85,204,0.25)' : 'rgba(0,85,204,0.12)')
                    : (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, overflow: 'hidden',
                  border: active ? `1px solid ${T.accent}40` : `1px solid ${T.border}`,
                }}>
                  <img
                    src={`https://flagcdn.com/28x21/${b.flagCode}.png`}
                    srcSet={`https://flagcdn.com/56x42/${b.flagCode}.png 2x`}
                    alt={b.id}
                    style={{ width: 22, height: 'auto', borderRadius: 2, display: 'block' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: active ? 700 : 600,
                    color: active ? T.accent : T.txt,
                    letterSpacing: '0.02em',
                  }}>
                    {b.id}
                  </div>
                  <div style={{
                    fontSize: 10, color: T.sub2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {b.name.split('–')[1]?.trim()}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── CONTENT PANEL ─────────────────────────────────────────────────── */}
        <div style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          overflow: 'hidden',
          minWidth: 0,
        }}>

          {/* Bank header */}
          <div style={{
            padding: isMobile ? '14px' : '18px 24px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            {/* Name + flag */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: darkMode ? 'rgba(0,85,204,0.15)' : 'rgba(0,85,204,0.08)',
                border: `1px solid ${T.accent}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, overflow: 'hidden',
              }}>
                <img
                  src={`https://flagcdn.com/40x30/${bank.flagCode}.png`}
                  srcSet={`https://flagcdn.com/80x60/${bank.flagCode}.png 2x`}
                  alt={bank.id}
                  style={{ width: 34, height: 'auto', borderRadius: 3, display: 'block' }}
                />
              </div>
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: isMobile ? 15 : 18, fontWeight: 700, color: T.txt }}>
                  {bank.name}
                </h3>
                <span style={{ fontSize: 11, color: T.sub }}>{bank.desc}</span>
              </div>
            </div>

            {/* Meta chips */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Próxima reunión */}
              <div style={{
                padding: '8px 14px', borderRadius: 10,
                background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
                border: `1px solid ${T.border}`,
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 3 }}>
                  PRÓXIMA REUNIÓN
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.txt }}>{bank.nextMeeting}</div>
              </div>
              {/* Impacto */}
              <div style={{
                padding: '8px 14px', borderRadius: 10,
                background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
                border: `1px solid ${T.border}`,
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 3 }}>
                  IMPACTO
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1,2,3].map(i => (
                    <span key={i} style={{ fontSize: 14, color: '#ef4444' }}>★</span>
                  ))}
                </div>
              </div>
              {/* Señal */}
              <div style={{
                padding: '8px 14px', borderRadius: 10,
                background: bank.signal.color + (darkMode ? '18' : '12'),
                border: `1px solid ${bank.signal.color}35`,
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 3 }}>
                  SEÑAL ACTUAL
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: bank.signal.color }}>
                  {bank.signal.label}
                </div>
                <div style={{ fontSize: 10, color: T.sub, marginTop: 1 }}>{bank.signal.desc}</div>
              </div>
            </div>
          </div>

          {/* 4 metric tiles */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            borderBottom: `1px solid ${T.border}`,
          }}>
            {[
              { label: 'ACTUAL',    value: bank.current.toFixed(2) + '%', color: bank.signal.color, big: true },
              { label: 'ANTERIOR',  value: bank.previous.toFixed(2) + '%' },
              { label: 'CONSENSO',  value: bank.consensus.toFixed(2) + '%' },
              {
                label: 'SORPRESA',
                value: (bank.surprise >= 0 ? '+' : '') + bank.surprise.toFixed(2) + '%',
                color: surpriseColor,
              },
            ].map(({ label, value, color, big }, i) => (
              <div key={label} style={{
                padding: '16px 20px',
                borderRight: i < 3 ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.08em', marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{
                  fontSize: big ? (isMobile ? 26 : 32) : (isMobile ? 18 : 22),
                  fontWeight: 800, fontFamily: 'monospace',
                  color: color || T.txt, letterSpacing: '-0.5px',
                  lineHeight: 1,
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ padding: isMobile ? '14px' : '20px 24px', borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.sub, marginBottom: 12 }}>
              Evolución histórica del tipo de interés (%)
            </div>
            <RateChart history={bank.history} color={bank.signal.color} darkMode={darkMode} />
          </div>

          {/* Decisions table */}
          <div style={{ padding: isMobile ? '14px' : '20px 24px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.txt, marginBottom: 12 }}>
              Últimas decisiones
            </div>

            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile
                ? '90px 70px 70px 70px 1fr'
                : '130px 100px 100px 100px 100px 1fr 80px',
              gap: 4, paddingBottom: 8,
              borderBottom: `1px solid ${T.border}`,
              marginBottom: 2,
            }}>
              {(isMobile
                ? ['FECHA','TIPO ACT.','ANTERIOR','CONS.','DECISIÓN']
                : ['FECHA','TIPO ACTUAL','ANTERIOR','CONSENSO','SORPRESA','DECISIÓN','IMPACTO']
              ).map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 700, color: T.sub2, letterSpacing: '0.07em' }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Table rows */}
            {bank.decisions.map((dec, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? '90px 70px 70px 70px 1fr'
                  : '130px 100px 100px 100px 100px 1fr 80px',
                gap: 4,
                padding: '10px 0',
                borderBottom: i < bank.decisions.length - 1 ? `1px solid ${T.border}` : 'none',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: T.sub }}>{dec.date}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.txt, fontFamily: 'monospace' }}>
                  {dec.rate}
                </span>
                <span style={{ fontSize: 12, color: T.sub, fontFamily: 'monospace' }}>{dec.prev}</span>
                <span style={{ fontSize: 12, color: T.sub, fontFamily: 'monospace' }}>{dec.cons}</span>
                {!isMobile && (
                  <span style={{
                    fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                    color: dec.bull ? '#22c55e' : dec.bear ? (dec.surp?.startsWith('-') ? '#ef4444' : T.sub) : T.sub,
                  }}>
                    {dec.surp}
                  </span>
                )}
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: dec.bear && dec.decision.includes('Recorte') ? '#ef4444'
                       : dec.bull && dec.decision.includes('Subida') ? '#22c55e'
                       : T.sub,
                }}>
                  {dec.decision}
                </span>
                {!isMobile && (
                  <div style={{ display: 'flex', gap: 1 }}>
                    {[1,2,3].map(s => (
                      <span key={s} style={{
                        fontSize: 11,
                        color: s <= dec.impact ? '#ef4444' : (darkMode ? '#2a2d33' : '#d1d5db'),
                      }}>★</span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Footer */}
            <div style={{
              marginTop: 14, paddingTop: 12,
              borderTop: `1px solid ${T.border}`,
              display: 'flex', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 8,
            }}>
              <span style={{ fontSize: 9, color: T.sub2, fontStyle: 'italic' }}>
                Fuente: Investing.com – Datos en tiempo real
              </span>
              <span style={{ fontSize: 9, color: T.sub2 }}>
                Los datos mostrados son solo informativos y no constituyen asesoramiento financiero.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
