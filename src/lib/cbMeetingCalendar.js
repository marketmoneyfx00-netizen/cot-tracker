/**
 * cbMeetingCalendar.js
 *
 * Official scheduled meeting dates for G10+ central banks.
 * Each bank's calendar is an array of ISO-date objects:
 *   { s: 'YYYY-MM-DD', e?: 'YYYY-MM-DD' }   (e = end of multi-day meeting, optional)
 *
 * Sources:
 *   FED  — federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   ECB  — ecb.europa.eu/press/calendars/mgc
 *   BOE  — bankofengland.co.uk/monetary-policy/decision-dates-and-statements
 *   BOJ  — boj.or.jp/en/about/calendar
 *   SNB  — snb.ch/en/the-snb/mandates-goals/monetary-policy/policy-rate
 *   RBA  — rba.gov.au/monetary-policy/rba-board-minutes
 *   BOC  — bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/upcoming
 *   RBNZ — rbnz.govt.nz/monetary-policy/about-monetary-policy/upcoming-monetary-policy-statements
 *   NB   — norges-bank.no/en/topics/Monetary-policy/meeting-dates
 *   RIX  — riksbank.se/en-gb/monetary-policy/meeting-calendar
 *   PBOC — rule-based: LPR published on the 20th of each month
 *
 * UPDATE ANNUALLY: Add the next year's schedule each January.
 * Last updated: 2026-05-17
 */

// ── Schedule data ──────────────────────────────────────────────────────────────
const SCHEDULES = {
  FED: [
    // 2025 (all past by mid-2026, kept for completeness)
    { s: '2025-01-28', e: '2025-01-29' },
    { s: '2025-03-18', e: '2025-03-19' },
    { s: '2025-05-06', e: '2025-05-07' },
    { s: '2025-06-17', e: '2025-06-18' },
    { s: '2025-07-29', e: '2025-07-30' },
    { s: '2025-09-16', e: '2025-09-17' },
    { s: '2025-10-28', e: '2025-10-29' },
    { s: '2025-12-09', e: '2025-12-10' },
    // 2026
    { s: '2026-01-27', e: '2026-01-28' },
    { s: '2026-03-17', e: '2026-03-18' },
    { s: '2026-04-28', e: '2026-04-29' },
    { s: '2026-06-16', e: '2026-06-17' },
    { s: '2026-07-28', e: '2026-07-29' },
    { s: '2026-09-15', e: '2026-09-16' },
    { s: '2026-10-27', e: '2026-10-28' },
    { s: '2026-12-08', e: '2026-12-09' },
  ],

  BCE: [
    // 2025
    { s: '2025-01-30' },
    { s: '2025-03-06' },
    { s: '2025-04-17' },
    { s: '2025-06-05' },
    { s: '2025-07-24' },
    { s: '2025-09-11' },
    { s: '2025-10-23' },
    { s: '2025-12-18' },
    // 2026
    { s: '2026-01-22' },
    { s: '2026-03-05' },
    { s: '2026-04-16' },
    { s: '2026-06-04' },
    { s: '2026-07-23' },
    { s: '2026-09-10' },
    { s: '2026-10-22' },
    { s: '2026-12-17' },
  ],

  BOE: [
    // 2025
    { s: '2025-02-06' },
    { s: '2025-03-20' },
    { s: '2025-05-08' },
    { s: '2025-06-19' },
    { s: '2025-08-07' },
    { s: '2025-09-18' },
    { s: '2025-11-06' },
    { s: '2025-12-18' },
    // 2026
    { s: '2026-02-05' },
    { s: '2026-03-19' },
    { s: '2026-05-07' },
    { s: '2026-06-18' },
    { s: '2026-08-06' },
    { s: '2026-09-17' },
    { s: '2026-11-05' },
    { s: '2026-12-17' },
  ],

  BOJ: [
    // 2025
    { s: '2025-01-23', e: '2025-01-24' },
    { s: '2025-03-18', e: '2025-03-19' },
    { s: '2025-04-30', e: '2025-05-01' },
    { s: '2025-06-16', e: '2025-06-17' },
    { s: '2025-07-30', e: '2025-07-31' },
    { s: '2025-09-18', e: '2025-09-19' },
    { s: '2025-10-28', e: '2025-10-29' },
    { s: '2025-12-18', e: '2025-12-19' },
    // 2026
    { s: '2026-01-22', e: '2026-01-23' },
    { s: '2026-03-17', e: '2026-03-18' },
    { s: '2026-04-28', e: '2026-04-30' },
    { s: '2026-06-15', e: '2026-06-16' },
    { s: '2026-07-29', e: '2026-07-30' },
    { s: '2026-09-17', e: '2026-09-18' },
    { s: '2026-10-27', e: '2026-10-28' },
    { s: '2026-12-17', e: '2026-12-18' },
  ],

  SNB: [
    // 2025 (quarterly meetings)
    { s: '2025-03-20' },
    { s: '2025-06-19' },
    { s: '2025-09-25' },
    { s: '2025-12-11' },
    // 2026
    { s: '2026-03-19' },
    { s: '2026-06-18' },
    { s: '2026-09-24' },
    { s: '2026-12-10' },
  ],

  RBA: [
    // 2025
    { s: '2025-02-17', e: '2025-02-18' },
    { s: '2025-04-01' },
    { s: '2025-05-19', e: '2025-05-20' },
    { s: '2025-07-07', e: '2025-07-08' },
    { s: '2025-08-04', e: '2025-08-05' },
    { s: '2025-09-01', e: '2025-09-02' },
    { s: '2025-10-06', e: '2025-10-07' },
    { s: '2025-11-03', e: '2025-11-04' },
    { s: '2025-12-08', e: '2025-12-09' },
    // 2026
    { s: '2026-02-02', e: '2026-02-03' },
    { s: '2026-03-30', e: '2026-03-31' },
    { s: '2026-05-04', e: '2026-05-05' },
    { s: '2026-07-06', e: '2026-07-07' },
    { s: '2026-08-03', e: '2026-08-04' },
    { s: '2026-09-07', e: '2026-09-08' },
    { s: '2026-10-05', e: '2026-10-06' },
    { s: '2026-11-02', e: '2026-11-03' },
    { s: '2026-12-07', e: '2026-12-08' },
  ],

  BOC: [
    // 2025
    { s: '2025-01-29' },
    { s: '2025-03-12' },
    { s: '2025-04-16' },
    { s: '2025-06-04' },
    { s: '2025-07-30' },
    { s: '2025-09-17' },
    { s: '2025-10-29' },
    { s: '2025-12-10' },
    // 2026
    { s: '2026-01-21' },
    { s: '2026-03-04' },
    { s: '2026-04-15' },
    { s: '2026-06-03' },
    { s: '2026-07-15' },
    { s: '2026-09-09' },
    { s: '2026-10-21' },
    { s: '2026-12-09' },
  ],

  RBNZ: [
    // 2025
    { s: '2025-02-19' },
    { s: '2025-04-09' },
    { s: '2025-05-28' },
    { s: '2025-07-09' },
    { s: '2025-08-27' },
    { s: '2025-10-08' },
    { s: '2025-11-19' },
    // 2026
    { s: '2026-02-25' },
    { s: '2026-04-08' },
    { s: '2026-05-27' },
    { s: '2026-07-08' },
    { s: '2026-08-26' },
    { s: '2026-10-14' },
    { s: '2026-11-25' },
  ],

  NB: [
    // 2025
    { s: '2025-01-23' },
    { s: '2025-03-27' },
    { s: '2025-05-08' },
    { s: '2025-06-19' },
    { s: '2025-08-14' },
    { s: '2025-09-18' },
    { s: '2025-11-06' },
    { s: '2025-12-18' },
    // 2026
    { s: '2026-01-22' },
    { s: '2026-03-26' },
    { s: '2026-05-07' },
    { s: '2026-06-18' },
    { s: '2026-08-13' },
    { s: '2026-09-17' },
    { s: '2026-11-05' },
    { s: '2026-12-17' },
  ],

  RIX: [
    // 2025
    { s: '2025-01-29' },
    { s: '2025-03-27' },
    { s: '2025-05-07' },
    { s: '2025-06-18' },
    { s: '2025-08-28' },
    { s: '2025-09-25' },
    { s: '2025-11-06' },
    { s: '2025-12-17' },
    // 2026
    { s: '2026-01-28' },
    { s: '2026-03-26' },
    { s: '2026-05-06' },
    { s: '2026-06-17' },
    { s: '2026-08-27' },
    { s: '2026-09-24' },
    { s: '2026-11-05' },
    { s: '2026-12-16' },
  ],
};

// ── PBOC: LPR published on the 20th of each month ─────────────────────────────
function pbocNextMeeting(ref) {
  const d = new Date(ref);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed

  // The 20th of the current month (or next month if already past)
  const thisMonth20 = new Date(Date.UTC(y, m, 20));
  if (thisMonth20 > d) return { s: thisMonth20.toISOString().slice(0, 10) };

  const nextM = m === 11 ? 0 : m + 1;
  const nextY = m === 11 ? y + 1 : y;
  return { s: new Date(Date.UTC(nextY, nextM, 20)).toISOString().slice(0, 10) };
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function formatMeeting(entry) {
  if (!entry) return null;

  const parseDay  = iso => parseInt(iso.slice(8, 10), 10);
  const parseMon  = iso => parseInt(iso.slice(5, 7), 10) - 1; // 0-indexed
  const parseYear = iso => parseInt(iso.slice(0, 4), 10);

  const sd = parseDay(entry.s);
  const sm = parseMon(entry.s);
  const sy = parseYear(entry.s);

  if (!entry.e || entry.e === entry.s) {
    return `${sd} ${MONTHS_ES[sm]} ${sy}`;
  }

  const ed = parseDay(entry.e);
  const em = parseMon(entry.e);
  const ey = parseYear(entry.e);

  if (sm === em && sy === ey) {
    return `${sd}-${ed} ${MONTHS_ES[sm]} ${sy}`;
  }
  // Cross-month range (rare: e.g. Apr 30 - May 1)
  return `${sd} ${MONTHS_ES[sm]} – ${ed} ${MONTHS_ES[em]} ${ey}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the next scheduled meeting for a central bank after `referenceDate`.
 * @param {string} bankId   - e.g. 'FED', 'BCE', 'BOE'
 * @param {Date}   [ref]    - defaults to now
 * @returns {{ label: string, isoDate: string } | null}
 *   label   — formatted Spanish string, e.g. "17-18 jun 2026"
 *   isoDate — ISO start date, e.g. "2026-06-16"
 *   null    — if no future meeting is in the schedule
 */
export function getNextMeeting(bankId, ref = new Date()) {
  if (bankId === 'PBOC') {
    const entry = pbocNextMeeting(ref);
    return { label: formatMeeting(entry), isoDate: entry.s };
  }

  const schedule = SCHEDULES[bankId];
  if (!schedule) return null;

  const refIso = ref.toISOString().slice(0, 10);

  // Find first entry whose start date is strictly after today
  const next = schedule.find(e => e.s > refIso);
  if (!next) return null;

  return { label: formatMeeting(next), isoDate: next.s };
}

/**
 * Returns all scheduled meetings for a bank in a date range.
 * Useful for calendar overlays or diagnostics.
 */
export function getMeetingsInRange(bankId, from, to) {
  if (bankId === 'PBOC') return [];
  const schedule = SCHEDULES[bankId] ?? [];
  const f = from.toISOString().slice(0, 10);
  const t = to.toISOString().slice(0, 10);
  return schedule.filter(e => e.s >= f && e.s <= t);
}
