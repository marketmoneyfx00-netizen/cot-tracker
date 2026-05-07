// ESM — convertido desde CJS (package.json tiene "type":"module")
const PAIRS = [
  { key: 'US_DE', foreignKey: 'DE10Y' },
  { key: 'US_UK', foreignKey: 'UK10Y' },
  { key: 'US_JP', foreignKey: 'JP10Y' },
];

export function calculateSpreads(yields) {
  const spreads   = {};
  const direction = {};
  const momentum  = {};

  for (const { key, foreignKey } of PAIRS) {
    const usEntry  = yields.US10Y;
    const fgnEntry = yields[foreignKey];

    const usCur  = usEntry?.current  ?? null;
    const fgnCur = fgnEntry?.current ?? null;

    if (usCur === null || fgnCur === null) {
      spreads[key]   = null;
      direction[key] = 'flat';
      momentum[key]  = null;
      continue;
    }

    const spreadCur  = parseFloat((usCur - fgnCur).toFixed(4));
    spreads[key] = spreadCur;

    const usPrev  = usEntry?.prev  ?? null;
    const fgnPrev = fgnEntry?.prev ?? null;

    if (usPrev !== null && fgnPrev !== null) {
      const spreadPrev = parseFloat((usPrev - fgnPrev).toFixed(4));
      const delta      = parseFloat((spreadCur - spreadPrev).toFixed(4));
      momentum[key]    = delta;
      direction[key]   = delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat';
    } else {
      momentum[key]  = null;
      direction[key] = 'flat';
    }
  }

  return { spreads, direction, momentum };
}
