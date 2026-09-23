// USD → GNF conversion for investor contributions ("apports") — a US-based
// investor sends USD, others send GNF directly; this is what lets the app
// do that conversion instead of asking anyone to do it by hand.
//
// Data source: @fawazahmed0/currency-api, published daily as dated npm
// versions and served free via the jsdelivr CDN — no API key, no rate
// limit that matters at this app's volume, and genuinely covers GNF
// (confirmed live before building this: many free FX APIs don't track
// GNF at all — Frankfurter/ECB-based ones don't, since GNF isn't an ECB
// currency). Verified directly against the CDN before writing this file,
// not assumed from memory: exact date format is `{year}.{month}.{day}`
// with NO leading zeros on month/day (`2024.3.2`, not `2024.03.02` —
// the zero-padded form 404s) and the data only exists back to roughly
// March 2024.
const CURRENCY_API_BASE = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

// The maintainer occasionally misses a day (confirmed live: e.g.
// 2025-12-10 and 2026-08-19 both 404 while every day around them exists)
// — a single missed day is not worth failing the whole save over, so this
// steps backward looking for the nearest real snapshot before giving up.
const MAX_LOOKBACK_DAYS = 7;

function toApiVersion(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return `${y}.${m}.${d}`;
}

function shiftDate(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchRateForVersion(version: string): Promise<number | null> {
  try {
    const res = await fetch(`${CURRENCY_API_BASE}@${version}/v1/currencies/usd.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.usd?.gnf;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

// Returns the USD→GNF rate for the given date (YYYY-MM-DD), stepping
// backward up to MAX_LOOKBACK_DAYS on a miss, then falling back to
// today's rate as a last resort rather than blocking the save entirely —
// an approximate rate the user can see and correct beats no rate at all.
// Returns { rate, dateUsed } so the caller can tell the user when the
// actual date used differs from what they picked.
export async function getUsdToGnfRate(
  dateYMD: string
): Promise<{ rate: number; dateUsed: string } | null> {
  let candidate = dateYMD;
  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
    const rate = await fetchRateForVersion(toApiVersion(candidate));
    if (rate) return { rate, dateUsed: candidate };
    candidate = shiftDate(candidate, -1);
  }
  const latest = await fetchRateForVersion('latest');
  if (latest) return { rate: latest, dateUsed: new Date().toISOString().slice(0, 10) };
  return null;
}
