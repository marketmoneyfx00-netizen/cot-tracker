import { readFile, writeFile } from 'node:fs/promises';
import { captureCalendarWeek } from '../api/_lib/calendarSnapshot.js';

const file = new URL('../data/calendar-snapshot.json', import.meta.url);
const weeks = await readFile(file, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return {};
  throw error;
});
const now = new Date();
// Current week must succeed; never replace the last good file with an empty download.
const { from, ...snapshot } = await captureCalendarWeek(now);
weeks[from] = snapshot;
try {
  const { from: nextFrom, ...next } = await captureCalendarWeek(now, 'nextweek');
  weeks[nextFrom] = next;
} catch (error) { console.warn('Próxima semana todavía no disponible:', error.message); }
const saved = Object.fromEntries(Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a)).slice(0, 5));
await writeFile(file, JSON.stringify(saved, null, 2) + '\n');
console.log(`Calendario del ${from}: ${snapshot.events.length} eventos guardados.`);

