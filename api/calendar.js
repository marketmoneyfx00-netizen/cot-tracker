/**
 * api/calendar.js — Pipeline multi-fuente
 *
 * FUENTE 1: Forex Factory JSON         — estructura base, SIN actuals
 * FUENTE 2: RapidAPI / FXStreet        — actuals (RAPIDAPI_KEY en Vercel) ← PRINCIPAL
 *   Host:  economic-trading-forex-events-calendar.p.rapidapi.com
 *   Path:  /fxstreet
 *   Plan:  $12/mes · 25.000 req/mes
 *   Campos: name, countryCode, currencyCode, actual, consensus, previous
 * FUENTE 3: FXStreet scrape            — fallback sin key
 *
 * DIAGNÓSTICO: /api/calendar?range=thisweek&diag=1
 * MÉTRICAS:    /api/calendar?range=thisweek&metrics=1
 */

import { applyRateLimit } from './_lib/ratelimit.js';
import { setSecurityHeaders, handleCORS, validateCalendarParams, logSecurityEvent } from './_lib/security.js';

// ── Métricas de consumo ────────────────────────────────────────────────────────
const metrics = {
  rapidCalls:  0,   // llamadas reales a RapidAPI
  cacheHits:   0,   // respuestas servidas desde caché
  cacheMiss:   0,   // peticiones que cayeron al pipeline completo
  day:         new Date().toISOString().slice(0,10),
};
function resetMetricsIfNewDay() {
  const today = new Date().toISOString().slice(0,10);
  if (metrics.day !== today) {
    metrics.rapidCalls = 0; metrics.cacheHits = 0; metrics.cacheMiss = 0;
    metrics.day = today;
  }
}

// ── Caché en memoria ──────────────────────────────────────────────────────────
// cache[week] = { data, ts }     → caché del payload final por semana
// rapidCache  = { data, ts, from, to } → caché de la respuesta bruta de RapidAPI
const cache      = {};
let rapidCache   = null;
let prevWeekSlot = null;

// TTLs del payload final (calendar cache)
const TTL_FUTURE  = 60  * 1000;       // 60s  — eventos que aún no han ocurrido
const TTL_RECENT  = 5   * 60 * 1000;  // 5min — eventos pasados con actual pendiente
const TTL_HISTORY = 60  * 60 * 1000;  // 1h   — días anteriores (datos estables)

// TTL del caché de RapidAPI (raw data): 4 horas
// Con 25k req/mes y TTL=4h → máx 6 llamadas/día/semana ≈ 180 req/mes → muy dentro del plan
const RAPIDAPI_TTL = 4 * 60 * 60 * 1000;

function getTTL(week, events) {
  if (week === 'lastweek') return TTL_HISTORY;
  if (week === 'nextweek') return TTL_FUTURE;
  if (!events?.length) return TTL_RECENT;
  const nowMs = Date.now();
  const today = new Date().toISOString().slice(0,10);
  // Si hay eventos de hoy sin actual → refresh rápido
  const pendingToday = events.some(e => e.date?.slice(0,10)===today && e.actual===null && new Date(e.date).getTime()<nowMs);
  if (pendingToday) return TTL_RECENT;
  // Si todos los eventos pasados ya tienen actual → caché más largo
  return TTL_HISTORY;
}

// ── Normalización helpers ─────────────────────────────────────────────────────

// normStr: convierte cualquier valor a string limpio o null
// IMPORTANTE: 0 (cero) es un valor válido → nunca lo descartar
function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return (s === '' || s === 'null' || s === 'undefined' || s === 'N/A' || s === '-') ? null : s;
}

// normActual: especial para el campo actual — 0 es un resultado real válido
function normActual(v) {
  if (v === undefined || v === null) return null;
  // Número 0 es válido (ej: "Factory Orders 0%")
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'N/A' || s === '-') return null;
  // "0" como string también es válido
  return s;
}

function dateSlice(d) { return String(d || '').slice(0, 10); }

function weekBounds(anchor) {
  const d = anchor ? new Date(anchor) : new Date(), day = d.getDay() || 7;
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day + 1); mon.setUTCHours(0,0,0,0);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6); sun.setUTCHours(23,59,59,999);
  return { from: mon.toISOString().slice(0,10), to: sun.toISOString().slice(0,10) };
}
function lastWeekBounds() { const r = new Date(); r.setDate(r.getDate()-7); return weekBounds(r); }
function nextWeekBounds() { const r = new Date(); r.setDate(r.getDate()+7); return weekBounds(r); }
function getWeekStr(d) {
  const dt = new Date(dateSlice(d)+'T12:00:00Z'); if (isNaN(dt.getTime())) return 'unknown';
  const day = dt.getUTCDay() || 7; const thu = new Date(dt); thu.setUTCDate(dt.getUTCDate()+4-day);
  const y = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return `${thu.getUTCFullYear()}-W${String(Math.ceil(((thu-y)/86400000+1)/7)).padStart(2,'0')}`;
}

// ── Mapas de país ─────────────────────────────────────────────────────────────
const CMAP = {
  'united states':'US','usa':'US','us':'US',
  'united kingdom':'GB','uk':'GB','gb':'GB',
  'european union':'EU','euro area':'EU','eurozone':'EU','eu':'EU','emu':'EU','ecb':'EU',
  'japan':'JP','jp':'JP','canada':'CA','ca':'CA','australia':'AU','au':'AU',
  'new zealand':'NZ','nz':'NZ','china':'CN','cn':'CN','switzerland':'CH','ch':'CH',
  'germany':'DE','de':'DE','france':'FR','fr':'FR','italy':'IT','it':'IT','spain':'ES','es':'ES',
};
const CMAP2 = { USD:'US',EUR:'EU',GBP:'GB',JPY:'JP',CAD:'CA',AUD:'AU',NZD:'NZ',CHF:'CH',CNY:'CN' };
function nc(c) {
  if (!c) return '';
  return CMAP[c.toLowerCase().trim()] || CMAP2[c.toUpperCase()] || c.toUpperCase().slice(0,2);
}

// Países de la Eurozona — FF los agrupa todos bajo "EU"
// RapidAPI los devuelve con código específico (DE, FR, IT...)
const EUROZONE = new Set(['DE','FR','IT','ES','NL','AT','BE','FI','PT','IE','GR','SK','SI','LU','LV','EE','CY','MT','HR']);
function toFF_Country(rawCode) {
  const up = (rawCode || '').toUpperCase().trim();
  return EUROZONE.has(up) ? 'EU' : nc(rawCode);
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────
const SS = ['us ','uk ','gb ','eu ','euro ','eurozone ','euro area ','german ','germany ','france ','french ','japan ','japanese ','canada ','canadian ','australia ','australian ','china ','chinese '];
const SE = [' m/m',' mom',' (mom)',' q/q',' qoq',' y/y',' yoy',' (yoy)',' sa',' n.s.a.',' revised',' final',' flash',' preliminary',' advance',' prel',' (adv)',' annualized',' s.a.',' nsa',' s/a'];
function nn(n) {
  if (!n) return '';
  let s = n.toLowerCase()
    .replace(/\(m\/m\)/g,'mom').replace(/\(q\/q\)/g,'qoq').replace(/\(y\/y\)/g,'yoy')
    .replace(/month.?over.?month/g,'mom').replace(/year.?over.?year/g,'yoy')
    .replace(/non.manufacturing/g,'nonmanufacturing').replace(/non.farm/g,'nonfarm')
    // Eliminar proveedores de índices que difieren entre FF y RapidAPI
    // FF: "Construction PMI" | RA: "S&P Global / CIPS UK Construction PMI"
    .replace(/s&p\s*global\s*[\/\\]?\s*cips?\s*/gi, '')
    .replace(/s&p\s*global\s*/gi, '')
    .replace(/hco?b\s*/gi, '')           // "HCOB Manufacturing PMI" → "manufacturing pmi"
    .replace(/\bau\s+jibun\s+bank\b/gi, '')
    .replace(/\bjibun\s+bank\b/gi, '')
    .replace(/\bcaixin\b/gi, '')
    .replace(/\bivey\b/gi, '')
    .replace(/\bmarkit\b/gi, '')
    .replace(/\bcips\b/gi, '')
    .trim();
  for (const p of SS) { if (s.startsWith(p)) { s = s.slice(p.length); break; } }
  let prev = ''; while (prev !== s) { prev = s; for (const p of SE) { if (s.endsWith(p)) { s = s.slice(0, -p.length).trim(); break; } } }
  if (s.startsWith('advance ')) s = s.slice(8).trim();
  // Normalizar sector del PMI: "services pmi" → "pmi services" → no, mejor dejarlo limpio
  // pero colapsar "composite pmi" / "pmi" para que sean comparables
  return s.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  const la = a.slice(0,60), lb = b.slice(0,60);
  const dp = Array.from({length:la.length+1}, (_,i) => [i]);
  for (let j=1; j<=lb.length; j++) dp[0][j] = j;
  for (let i=1; i<=la.length; i++)
    for (let j=1; j<=lb.length; j++)
      dp[i][j] = la[i-1]===lb[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[la.length][lb.length];
}
function sim(a, b) {
  const na = nn(a), nb = nn(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  // PMI especial: si ambos tienen "pmi" y el mismo sector, score alto garantizado
  // Cubre: Construction PMI, Services PMI, Manufacturing PMI, Composite PMI
  if (na.includes('pmi') && nb.includes('pmi')) {
    const PMI_SECTORS = ['construction','services','manufacturing','composite','nonmanufacturing'];
    const sectorA = PMI_SECTORS.find(s => na.includes(s));
    const sectorB = PMI_SECTORS.find(s => nb.includes(s));
    // Mismo sector explícito → match perfecto
    if (sectorA && sectorB && sectorA === sectorB) return 0.97;
    // Al menos uno tiene sector y el otro no (ej: "PMI" genérico) → score alto
    if (sectorA || sectorB) return 0.88;
    // Ambos son PMI genérico → también match
    return 0.90;
  }

  return 1 - lev(na,nb) / Math.max(na.length, nb.length, 1);
}

// ── FUENTE 1: Forex Factory ───────────────────────────────────────────────────
const FF_HDR = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
  'Referer': 'https://www.forexfactory.com/',
  'Cache-Control': 'no-cache',
};
function normFF(ev) {
  return {
    event:    ev.title    || ev.name  || ev.event || '',
    country:  nc(ev.country),
    date:     ev.date     || '',
    impact:   ev.impact==='High' ? 'High' : ev.impact==='Medium' ? 'Medium' : 'Low',
    estimate: normStr(ev.forecast) ?? normStr(ev.estimate) ?? null,
    previous: normStr(ev.previous) ?? normStr(ev.prev) ?? null,
    actual:   normActual(ev.actual) ?? normActual(ev.actualValue) ?? null,
    unit:     ev.unit || '',
    _source:  'ff',
    _fetched_at: new Date().toISOString(),
  };
}
async function fetchFF(week) {
  const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${week}.json?t=${Date.now()}`, { headers:FF_HDR, signal:AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`FF HTTP ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw)) throw new Error('FF respuesta inesperada');
  const evs = raw.map(normFF);
  console.log(`[ff] ${week}: ${evs.length} eventos (${evs.filter(e=>e.actual!==null).length} con actual directo)`);
  return evs;
}

// ── FUENTE 2: RapidAPI / FXStreet Calendar (PRINCIPAL) ───────────────────────
// API: Economic & Trading & Forex Events Calendar
// Host: economic-trading-forex-events-calendar.p.rapidapi.com
// Path: /fxstreet
// Campos: name, countryCode, currencyCode, actual, consensus, previous, date/datetime
async function fetchRapidAPI(from, to) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.warn('[ra] ⚠️  RAPIDAPI_KEY no configurada — añadir en Vercel → Settings → Env Variables');
    return [];
  }

  // Caché hit: misma semana solicitada y dentro del TTL
  if (rapidCache && rapidCache.from === from && rapidCache.to === to &&
      (Date.now() - rapidCache.ts) < RAPIDAPI_TTL) {
    metrics.cacheHits++;
    console.log(`[ra] 📦 caché hit (${Math.round((Date.now()-rapidCache.ts)/60000)}min), ${rapidCache.data.length} eventos`);
    return rapidCache.data;
  }

  resetMetricsIfNewDay();
  metrics.rapidCalls++;
  metrics.cacheMiss++;

  try {
    // Incluir países relevantes para forex + eurozona individual para match correcto
    const countries = 'US,GB,DE,FR,IT,ES,JP,CA,AU,NZ,CH,CN,NL,AT,BE';
    const url = `https://economic-trading-forex-events-calendar.p.rapidapi.com/fxstreet?countries=${encodeURIComponent(countries)}&from=${from}&to=${to}`;
    console.log(`[ra] 🌐 fetching ${from} → ${to} (llamada #${metrics.rapidCalls} hoy)...`);

    const res = await fetch(url, {
      headers: {
        'Accept':          'application/json',
        'x-rapidapi-host': 'economic-trading-forex-events-calendar.p.rapidapi.com',
        'x-rapidapi-key':  key,
      },
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 429) {
      console.warn('[ra] ❌ 429 — límite mensual agotado. Usar caché stale.');
      return rapidCache?.data || [];
    }
    if (!res.ok) {
      console.warn(`[ra] HTTP ${res.status} — stale fallback`);
      return rapidCache?.data || [];
    }

    const raw = await res.json();

    // Manejar distintos formatos de respuesta
    const arr = Array.isArray(raw) ? raw : (raw?.data || raw?.result || raw?.events || []);
    if (!arr.length) {
      console.warn('[ra] respuesta vacía — stale fallback');
      return rapidCache?.data || [];
    }

    // Diagnóstico de estructura real
    const s = arr[0];
    console.log(`[ra] ✅ ${arr.length} eventos. Claves: ${Object.keys(s).join(', ')}`);
    console.log(`[ra] Sample[0]: name="${s.name||s.event}" country="${s.countryCode||s.country}" actual=${s.actual} consensus=${s.consensus} date="${s.date||s.datetime||s.eventDate}"`);
    const wa = arr.filter(e => normActual(e.actual) !== null).length;
    console.log(`[ra] Con actual: ${wa}/${arr.length}`);

    rapidCache = { data: arr, ts: Date.now(), from, to };
    return arr;

  } catch (e) {
    console.warn(`[ra] Error: ${e.message} — stale fallback`);
    return rapidCache?.data || [];
  }
}

// Normalizar evento de RapidAPI/FXStreet al formato interno
function normRapidAPI(ev) {
  const rawCountry = ev.countryCode || ev.country || ev.currency || '';
  const country    = toFF_Country(rawCountry);

  // Date: la API /fxstreet a veces no devuelve campo date — cubrir todos los alias
  const rawDate = ev.date || ev.datetime || ev.eventDate || ev.time
    || ev.releaseDate || ev.publishDate || ev.dateUtc || '';
  const date = rawDate ? rawDate.slice(0, 10) : '';

  // normActual: 0 numérico es dato válido
  const actual   = normActual(ev.actual);
  const estimate = normStr(String(ev.consensus ?? ev.forecast ?? ev.estimate ?? ''));
  const previous = normStr(String(ev.previous ?? ev.prev ?? ''));
  const event    = ev.name || ev.event || ev.indicator || ev.title || '';

  return { event, country, date, actual, estimate, previous,
    _isBetter: ev.isBetterThanExpected ?? null, _ra: true };
}

// ── FUENTE 3: FXStreet scrape (fallback) ─────────────────────────────────────
async function fetchFXStreet(from, to) {
  const fromDT = `${from}T00:00:00Z`, toDT = `${to}T23:59:59Z`;
  const eps = [
    { url:`https://calendar.fxstreet.com/EventDateProvider/GetEventsByDate?dateFrom=${fromDT}&dateTo=${toDT}&timezone=UTC`, hdr:{'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.fxstreet.com/economic-calendar','Origin':'https://www.fxstreet.com'} },
    { url:`https://app-data-cache.fxstreet.com/calendar/events?dateFrom=${fromDT}&dateTo=${toDT}`,                          hdr:{'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.fxstreet.com/'} },
  ];
  for (const ep of eps) {
    try {
      const r = await fetch(ep.url, { headers: ep.hdr, signal: AbortSignal.timeout(5000) });
      if (!r.ok) { console.log(`[fxs] HTTP ${r.status}`); continue; }
      const raw = await r.json();
      const arr = Array.isArray(raw) ? raw : (raw?.events || raw?.data || []);
      if (!arr.length) { console.log('[fxs] vacío'); continue; }
      const wa = arr.filter(e => normActual(e.Actual ?? e.actual) !== null).length;
      console.log(`[fxs] ✅ ${arr.length} eventos, ${wa} con actual`);
      return arr;
    } catch (e) { console.log(`[fxs] ${e.message}`); }
  }
  return [];
}

// ── Índice y matching ─────────────────────────────────────────────────────────
function buildIdx(evs, getDay, getCC, getName) {
  const byCC = {}, byDate = {}, byCC_nodate = {};
  for (const ev of evs) {
    const d  = dateSlice(getDay(ev));
    const cc = getCC(ev);
    const k  = `${d}::${cc}`;
    (byCC[k]       = byCC[k]       || []).push(ev);
    (byDate[d]     = byDate[d]     || []).push(ev);
    // Índice sin fecha: solo por país (para cuando API no devuelve date)
    (byCC_nodate[cc] = byCC_nodate[cc] || []).push(ev);
  }
  return { byCC, byDate, byCC_nodate };
}

function bestMatch(ffEv, idx, getName, getCC, minScore = 0.42) {
  const d  = dateSlice(ffEv.date);
  const cc = ffEv.country;

  // Estrategia 1: fecha exacta + país
  let cands = idx.byCC[`${d}::${cc}`] || [];

  // Estrategia 2: mismo día, filtrar por país
  if (!cands.length && idx.byDate[d]) {
    cands = idx.byDate[d].filter(e => getCC(e) === cc);
  }

  // Estrategia 3: sin fecha (API /fxstreet no siempre la devuelve)
  // Buscar en todos los eventos del mismo país por nombre
  if (!cands.length && idx.byCC_nodate[cc]) {
    cands = idx.byCC_nodate[cc];
    console.log(`[match] ⚠️  sin fecha — buscando "${ffEv.event}"(${cc}) en ${cands.length} cands sin fecha`);
  }

  if (!cands.length) return null;

  let best = null, bestScore = 0;
  for (const c of cands) {
    const s = sim(ffEv.event, getName(c));
    if (s > bestScore) { bestScore = s; best = c; }
  }

  if (best) {
    const hit = bestScore >= minScore ? '✅' : '❌';
    console.log(`[match] ${hit} "${ffEv.event}"(${cc}/${d}) ↔ "${getName(best)}" score=${bestScore.toFixed(2)} cands=${cands.length}`);
  }

  if (bestScore >= minScore) return { ev: best, score: bestScore };
  if (cands.length === 1) {
    console.log(`[match] forced "${ffEv.event}" → único cand`);
    return { ev: best, score: bestScore, forced: true };
  }
  return null;
}

// ── Merge principal ───────────────────────────────────────────────────────────
function mergeActuals(ffEvents, raEvents, fxsEvents) {
  const raNorm = raEvents.map(normRapidAPI);

  // ── DIAGNÓSTICO COMPLETO ───────────────────────────────────────────────
  console.log(`[merge] RA raw count=${raEvents.length}, normalized=${raNorm.length}`);
  if (raEvents.length > 0) {
    console.log(`[merge] RA[0] raw keys: ${Object.keys(raEvents[0]).join(',')}`);
    const s = raNorm[0];
    console.log(`[merge] RA[0] norm: event="${s.event}" country="${s.country}" date="${s.date}" actual=${JSON.stringify(s.actual)}`);
  }
  if (raNorm.length > 0) {
    const withDate   = raNorm.filter(e => e.date !== '').length;
    const withActual = raNorm.filter(e => e.actual !== null).length;
    const countries  = [...new Set(raNorm.map(e => e.country))].sort().join(',');
    console.log(`[merge] RA: ${raNorm.length} total, ${withDate} con fecha, ${withActual} con actual, países: [${countries}]`);
  }

  const raIdx  = buildIdx(raNorm,    e => e.date || '',    e => e.country || '',  e => e.event || '');
  const fxsIdx = buildIdx(fxsEvents,
    e => e.EventDate||e.eventDate||e.date||'',
    e => { const r=e.CountryCode||e.countryCode||e.country||e.Currency||''; return EUROZONE.has(r.toUpperCase())?'EU':r; },
    e => e.Name||e.name||e.Event||e.event||'');
  const fxsGetCC = e => { const r=e.CountryCode||e.countryCode||e.country||e.Currency||''; return EUROZONE.has(r.toUpperCase())?'EU':r; };

  const nowMs = Date.now();
  let nRA = 0, nFXS = 0, nMiss = 0;
  console.log(`[merge] Iniciando: ff=${ffEvents.length} rapidapi=${raNorm.length} fxs=${fxsEvents.length}`);

  const result = ffEvents.map(ffEv => {
    if (new Date(ffEv.date).getTime() >= nowMs) return ffEv;
    if (ffEv.actual !== null) return ffEv;

    // ── 1. RapidAPI (prioridad absoluta) ──────────────────────────────────
    if (raNorm.length > 0) {
      const m = bestMatch(ffEv, raIdx, e => e.event || '', e => e.country || '');

      // LOG: traza completa FF → RA → FINAL
      console.log(`[merge] FF: "${ffEv.event}" (${ffEv.country}) actual=${JSON.stringify(ffEv.actual)}`);
      if (m) {
        console.log(`[merge] RA: "${m.ev.event}" actual=${JSON.stringify(m.ev.actual)} score=${m.score?.toFixed(2)}`);
      } else {
        console.log(`[merge] RA: sin match para "${ffEv.event}" (${ffEv.country}/${dateSlice(ffEv.date)})`);
      }

      if (m) {
        // Merge explícito: RA tiene prioridad absoluta
        const actual   = normActual(m.ev.actual)   ?? normActual(ffEv.actual)   ?? null;
        const estimate = normStr(m.ev.estimate)     ?? normStr(ffEv.estimate)    ?? null;
        const previous = normStr(m.ev.previous)     ?? normStr(ffEv.previous)    ?? null;

        console.log(`[merge] FINAL: "${ffEv.event}" actual=${JSON.stringify(actual)}`);

        if (actual !== null) {
          nRA++;
          return { ...ffEv, actual, estimate, previous, _source:'ra_enriched', _isBetter: m.ev._isBetter ?? null };
        }
        console.log(`[merge] ⚠️  RA match pero actual=null para "${ffEv.event}"`);
      }
    }

    // ── 2. FXStreet scrape (fallback) ────────────────────────────────────
    if (fxsEvents.length > 0) {
      const m = bestMatch(ffEv, fxsIdx, e => e.Name||e.name||e.Event||e.event||'', fxsGetCC);
      if (m) {
        const actual = normActual(m.ev.Actual ?? m.ev.actual ?? m.ev.ActualValue ?? null)
          ?? normActual(ffEv.actual) ?? null;
        if (actual !== null) {
          nFXS++;
          return {
            ...ffEv, actual,
            estimate: normStr(m.ev.Consensus??m.ev.consensus??null) ?? normStr(ffEv.estimate) ?? null,
            previous: normStr(m.ev.Previous??m.ev.previous??null)   ?? normStr(ffEv.previous) ?? null,
            _source: 'fxs_enriched',
          };
        }
      }
    }

    nMiss++;
    return ffEv;
  });

  console.log(`[merge] ✅ ra=${nRA} fxs=${nFXS} sin_dato=${nMiss}`);
  return result;
}

// ── Normalización final de salida ─────────────────────────────────────────────
// normalizeEvent: normaliza estructura final + marca isPending SOLO para eventos
// macro que publican dato numérico y aún no lo tienen. NUNCA speeches/auctions/minutes.
function normalizeEvent(ev, nowMs) {
  if (ev._meta) return ev;
  const isPast   = new Date(ev.date).getTime() < nowMs;
  const actual   = normActual(ev.actual ?? ev.actual_value ?? ev.result ?? ev.value ?? null);
  const estimate = normStr(ev.estimate ?? ev.forecast ?? ev.consensus ?? ev.expected ?? null);
  const previous = normStr(ev.previous ?? ev.prior ?? ev.prev ?? ev.last ?? null);

  const eventName = (ev.event || ev.name || '').toLowerCase();
  const nonNumeric =
    ev.isSpeech ||
    ev.isReport ||
    /auction|speech|minutes|statement|report|press.?conference|testimo|speaks|outlook|survey|bulletin|opec/i.test(eventName);

  // isPending: SOLO true si el evento ya pasó, no tiene actual, Y normalmente publica número
  const isPending = isPast && actual === null && !nonNumeric;

  return {
    date:        ev.date        || '',
    event:       ev.event       || ev.title || ev.name || '',
    country:     ev.country     || '',
    impact:      ev.impact      || 'Low',
    actual,
    estimate,
    previous,
    unit:        ev.unit        || '',
    isPending,
    _source:     ev._source     || 'ff',
    _isBetter:   ev._isBetter   ?? null,
    _fetched_at: ev._fetched_at || '',
  };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
async function pipeline(week) {
  const bounds = week==='lastweek' ? lastWeekBounds() : week==='nextweek' ? nextWeekBounds() : weekBounds();

  // FF base events
  let ffEvents = [], ffError = null;
  if (week === 'lastweek') {
    try {
      const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_lastweek.json?t=${Date.now()}`, { headers:FF_HDR, signal:AbortSignal.timeout(5000) });
      if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) ffEvents = d.map(normFF); }
    } catch(_) {}
    if (!ffEvents.length && prevWeekSlot) {
      if (prevWeekSlot.weekStr === getWeekStr(bounds.from)) ffEvents = prevWeekSlot.data;
    }
  } else {
    try {
      ffEvents = await fetchFF(week);
      if (week === 'thisweek' && ffEvents.length) {
        prevWeekSlot = { data: ffEvents, weekStr: getWeekStr(ffEvents[0].date), ts: Date.now() };
      }
    } catch (e) { ffError = e.message; console.error(`[ff] ${e.message}`); }
  }

  const nowMs   = Date.now();
  const pending = ffEvents.filter(e => new Date(e.date).getTime() < nowMs && e.actual === null);
  console.log(`[pipeline] ${week}: ff=${ffEvents.length} pending=${pending.length} bounds=${bounds.from}→${bounds.to}`);

  if (ffEvents.length === 0)    return { events: [], ffError };
  if (pending.length === 0)     return { events: ffEvents, ffError };

  // Fetch fuentes en paralelo
  console.log('[pipeline] Lanzando RA + FXS...');
  const [raEvents, fxsEvents] = await Promise.all([
    fetchRapidAPI(bounds.from, bounds.to),
    fetchFXStreet(bounds.from, bounds.to),
  ]);
  console.log(`[pipeline] ra=${raEvents.length} fxs=${fxsEvents.length}`);

  if (!raEvents.length && !fxsEvents.length) {
    console.warn('[pipeline] ⚠️  Sin fuentes secundarias. Verificar RAPIDAPI_KEY y cuota.');
    return { events: ffEvents, ffError };
  }

  const result = mergeActuals(ffEvents, raEvents, fxsEvents);
  const wa  = result.filter(e => e.actual !== null).length;
  const wp  = result.filter(e => new Date(e.date).getTime() < nowMs && e.actual === null).length;
  console.log(`[pipeline] ✅ total=${result.length} actual=${wa} pendientes=${wp}`);
  return { events: result, ffError };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (handleCORS(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  if (applyRateLimit(req, res, 'api')) return;

  const v = validateCalendarParams(req.query);
  if (!v.ok) {
    logSecurityEvent('INVALID_INPUT', { endpoint:'/api/calendar', error:v.error });
    return res.status(400).json({ ok:false, error:v.error });
  }

  const { range:week, force } = v;
  const diag    = req.query.diag    === '1';
  const showMet = req.query.metrics === '1';
  resetMetricsIfNewDay();

  // ── Endpoint de métricas ────────────────────────────────────────────────
  if (showMet) {
    return res.status(200).json({
      _metrics: true,
      date:       metrics.day,
      rapidCalls: metrics.rapidCalls,
      cacheHits:  metrics.cacheHits,
      cacheMiss:  metrics.cacheMiss,
      rapidCacheAge: rapidCache ? Math.round((Date.now()-rapidCache.ts)/60000)+'min' : 'no cache',
      rapidCacheTTL: Math.round(RAPIDAPI_TTL/3600000)+'h',
      estimatedMonthly: metrics.rapidCalls * 30,
      plan: '25.000 req/mes',
    });
  }

  // ── Cache hit ───────────────────────────────────────────────────────────
  const now = Date.now(), cached = cache[week];
  const realCached = cached?.data?.filter(e => !e._meta) || [];
  const ttl = getTTL(week, realCached);

  if (!force && !diag && cached && (now - cached.ts) < ttl) {
    metrics.cacheHits++;
    res.setHeader('X-Cache',     'HIT');
    res.setHeader('X-Cache-Age', Math.round((now-cached.ts)/1000)+'s');
    return res.status(200).json(cached.data);
  }

  metrics.cacheMiss++;

  try {
    // ── Modo diagnóstico ──────────────────────────────────────────────────
    if (diag) {
      const bounds = week==='lastweek' ? lastWeekBounds() : week==='nextweek' ? nextWeekBounds() : weekBounds();
      const [raRaw, fxsRaw] = await Promise.all([
        fetchRapidAPI(bounds.from, bounds.to),
        fetchFXStreet(bounds.from, bounds.to),
      ]);
      const raNorm = raRaw.map(normRapidAPI);
      return res.status(200).json({
        _diag:   true,
        bounds,
        env:     { hasRapidAPI: !!process.env.RAPIDAPI_KEY },
        rapidapi: {
          count:      raRaw.length,
          withActual: raRaw.filter(e => normActual(e.actual) !== null).length,
          sampleRaw:  raRaw.slice(0, 3),
          sampleNorm: raNorm.slice(0, 3),
          countriesFound: [...new Set(raNorm.map(e=>e.country))].sort(),
        },
        fxs: {
          count:      fxsRaw.length,
          withActual: fxsRaw.filter(e => normActual(e.Actual??e.actual) !== null).length,
          sample:     fxsRaw.slice(0, 2),
        },
      });
    }

    // ── Pipeline normal ───────────────────────────────────────────────────
    const { events, ffError } = await pipeline(week);
    const nowMs = Date.now();

    const payload = [...events].map(ev => normalizeEvent(ev, nowMs));

    if (!events.length) {
      const msgs = {
        lastweek: 'Forex Factory no expone datos históricos. Disponibles si el servidor los guardó durante esa semana.',
        nextweek:  'Forex Factory publica el calendario de la próxima semana habitualmente el jueves o viernes.',
      };
      if (msgs[week]) payload.push({ _meta:true, _empty_reason:msgs[week] });
    }

    if (!payload.filter(e=>!e._meta).length && realCached.length > 0) {
      res.setHeader('X-Cache', 'STALE-KEPT');
      return res.status(200).json(cached.data);
    }

    cache[week] = { data: payload, ts: now };

    const wa  = payload.filter(e => !e._meta && e.actual !== null).length;
    const wra = payload.filter(e => e._source === 'ra_enriched').length;
    const wp  = payload.filter(e => !e._meta && e.isPending).length;

    res.setHeader('X-Cache',       'MISS');
    res.setHeader('X-With-Actual', wa.toString());
    res.setHeader('X-From-RA',     wra.toString());
    res.setHeader('X-Pending',     wp.toString());
    res.setHeader('X-RA-Calls-Today', metrics.rapidCalls.toString());

    return res.status(200).json(payload);

  } catch (err) {
    console.error(`[cal] Fatal ${week}:`, err.message, err.stack?.slice(0,300));
    if (cached) { res.setHeader('X-Cache','STALE'); return res.status(200).json(cached.data); }
    return res.status(200).json([]);
  }
}
