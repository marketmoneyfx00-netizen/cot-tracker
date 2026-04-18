/**
 * api/pulse.js — Market Pulse Live Feed v3
 *
 * Two-tier scoring:
 *   TIER A — High-value rules: specific verb+noun combos → score 7–9
 *   TIER B — Broad context rules: single keywords → score 3–5 (fallback net)
 *
 * This ensures a healthy mix: precise events at top, context items below.
 * Minimum threshold: score >= 3 (previously 5 — was too aggressive).
 *
 * Dynamic direction: inferred from sentiment words in title (rises/falls/beats/misses).
 * Sources: ForexLive + Reuters (with graceful fallback if blocked).
 */

import { setSecurityHeaders, handleCORS } from './_lib/security.js';
import { scoreNews, inferMarketRegime } from './_lib/newsScoringEngine.js';

// ── Cache ─────────────────────────────────────────────────────────────────────
let _cache = null;
const CACHE_TTL = 5 * 60 * 1000;

// ── RSS Sources ───────────────────────────────────────────────────────────────
const FEED_SOURCES = [
  { name: 'ForexLive',        url: 'https://www.forexlive.com/feed/',                         priority: 1 },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews',           priority: 2 },
  { name: 'Reuters Top',      url: 'https://feeds.reuters.com/reuters/topNews',                priority: 3 },
  { name: 'Investing.com',    url: 'https://www.investing.com/rss/news.rss',                   priority: 4 },
];

// ── RSS parser ────────────────────────────────────────────────────────────────
function parseRSS(xml, sourceName, regime = {}) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
      const m = r.exec(block);
      if (!m) return '';
      return (m[1] || m[2] || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
    };

    const title   = getTag('title');
    const pubDate = getTag('pubDate');
    const link    = getTag('link') || (/<link[^>]*>(.*?)<\/link>/i.exec(block)||[])[1]?.trim() || '';
    const guid    = getTag('guid') || link || title;

    if (!title || title.length < 8) continue;

    const scored = scoreNews(title, {}, regime);
    if (!scored) continue;
    // Skip truly irrelevant (score too low — generic non-macro)
    if (scored.score < 1.5) continue;

    let ts = Date.now();
    try { const d = new Date(pubDate); if (!isNaN(d.getTime())) ts = d.getTime(); } catch(_) {}

    items.push({
      id:       guid.slice(0, 80),
      headline: title.slice(0, 180),
      link:     link.startsWith('http') ? link : '',
      ts,
      source:   sourceName,
      ...scored,
    });
  }

  return items;
}

// ── Relative timestamp ────────────────────────────────────────────────────────
function relativeTs(tsMs) {
  const diff = Math.floor((Date.now() - tsMs) / 1000);
  if (diff < 60)    return 'Ahora';
  if (diff < 3600)  return `Hace ${Math.floor(diff/60)}min`;
  if (diff < 86400) return `Hace ${Math.floor(diff/3600)}h`;
  return `Hace ${Math.floor(diff/86400)}d`;
}

// ── Fetch one RSS ─────────────────────────────────────────────────────────────
async function fetchFeed({ url, name }, regime = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
      console.warn(`[pulse] ${name} HTTP ${res.status}`);
      return [];
    }
    const xml  = await res.text();
    const raw  = (xml.match(/<item/gi) || []).length;
    const items = parseRSS(xml, name, regime);
    console.log(`[pulse][debug] ${name}: rawItems=${raw} afterScore=${items.length} tierA=${items.filter(i=>i.tier==='A').length} tierB=${items.filter(i=>i.tier==='B').length}`);
    return items;
  } catch (e) {
    console.warn(`[pulse] ${name}: ${e.message}`);
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (handleCORS(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  if (_cache && (Date.now() - _cache.ts) < CACHE_TTL) {
    res.setHeader('X-Cache',     'HIT');
    res.setHeader('X-Cache-Age', Math.round((Date.now() - _cache.ts) / 1000) + 's');
    return res.status(200).json(_cache.data);
  }

  try {
    // ── Two-pass scoring ─────────────────────────────────────────────────
    // Pass 1: fetch all items WITHOUT regime (regime = {}) to collect titles
    const rawResults  = await Promise.all(FEED_SOURCES.map(s => fetchFeed(s, {})));
    const rawAll      = rawResults.flat();
    const recentTitles = rawAll.map(i => i.headline).slice(0, 20);

    // Infer market regime from the collected headlines
    const regime = inferMarketRegime(recentTitles);
    console.log('[pulse] regime:', JSON.stringify(regime));

    // Pass 2: re-score with regime context
    const results = await Promise.all(FEED_SOURCES.map(s => fetchFeed(s, regime)));
    const all     = results.flat();

    // Deduplicate — looser key (first 50 chars) to avoid over-deduplication
    const seen   = new Set();
    const deduped = all.filter(item => {
      const key = item.headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g,' ').trim().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: newest first (absolute priority)
    // Only use score as tiebreaker within a 5-minute window
    deduped.sort((a, b) => {
      const timeDiff = b.ts - a.ts;
      if (Math.abs(timeDiff) > 300000) return timeDiff;  // >5min → strict recency
      return b.score - a.score;                           // ≤5min → score tiebreaker
    });

    const payload = deduped.slice(0, 25).map(item => ({
      ...item,
      tsRelative: relativeTs(item.ts),
    }));

    const tierA = payload.filter(i => i.tier === 'A').length;
    const tierB = payload.filter(i => i.tier === 'B').length;
    const cats = [...new Set(payload.map(i=>i.category))].join(',');
    console.log(`[pulse] ✅ total=${payload.length} tierA=${tierA} tierB=${tierB} cats=[${cats}] avgScore=${(payload.reduce((s,i)=>s+i.score,0)/Math.max(payload.length,1)).toFixed(1)}`);

    _cache = { data: payload, ts: Date.now() };
    res.setHeader('X-Cache',      'MISS');
    res.setHeader('X-Item-Count', payload.length.toString());
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[pulse] Fatal:', err.message);
    if (_cache) return res.status(200).json(_cache.data);
    return res.status(200).json([]);
  }
}
