export async function captureCalendarWeek(now = new Date(), range = 'thisweek') {
  if (!['thisweek', 'nextweek'].includes(range)) throw new Error('Rango no permitido.');
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  if (range === 'nextweek') monday.setUTCDate(monday.getUTCDate() + 7);
  const from = monday.toISOString().slice(0, 10);
  monday.setUTCDate(monday.getUTCDate() + 6);
  const to = monday.toISOString().slice(0, 10);

  const response = await fetch(`https://nfs.faireconomy.media/ff_calendar_${range}.json`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Forex Factory HTTP ${response.status}`);
  const raw = await response.json();
  if (!Array.isArray(raw)) throw new Error('Formato de calendario inesperado.');

  const events = raw.filter(event => {
    if (typeof event?.title !== 'string' || !event.title.trim() || !Number.isFinite(Date.parse(event.date))) return false;
    const day = new Date(event.date).toISOString().slice(0, 10);
    return day >= from && day <= to;
  }).map(({ title, country, date, impact, forecast, previous, actual }) => ({
    title, country, date, impact, forecast, previous, actual,
  }));

  if (!events.length) throw new Error(`La fuente no contiene eventos de la semana del ${from}.`);
  return { from, capturedAt: now.toISOString(), events };
}

export function validCalendarSnapshot(snapshot, from, now = new Date()) {
  const captured = Date.parse(snapshot?.capturedAt);
  if (!Number.isFinite(captured) || captured > now.getTime() + 300000 || !Array.isArray(snapshot?.events) || !snapshot.events.length) return false;
  const end = Date.parse(`${from}T00:00:00Z`) + 7 * 86400000;
  return snapshot.events.every(event => typeof event?.title === 'string' && event.title.trim()
    && Date.parse(event.date) >= Date.parse(`${from}T00:00:00Z`) && Date.parse(event.date) < end);
}

// Public market data only. GitHub runs independently of Cloudflare's outbound IP.
export async function fetchPublishedCalendarSnapshots() {
  const response = await fetch('https://raw.githubusercontent.com/marketmoneyfx00-netizen/cot-tracker/master/data/calendar-snapshot.json', {
    signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Calendario publicado HTTP ${response.status}`);
  const weeks = await response.json();
  return Object.fromEntries(Object.entries(weeks).filter(([from, snapshot]) => /^\d{4}-\d{2}-\d{2}$/.test(from) && validCalendarSnapshot(snapshot, from)));
}
