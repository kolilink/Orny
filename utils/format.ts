// Thousands-grouped digits, no currency suffix — for screens that repeat a
// price many times in a row (a product grid, a cart) where this app only
// ever operates in one currency (GNF) and the region is Guinea only, so
// stamping "GNF" on every single line is pure repetition. Reserve
// formatGNF() itself for the one or two totals on a screen that actually
// benefit from the explicit unit.
export const formatNumber = (amount: number): string => {
  const rounded = Math.round(amount);
  const str = rounded.toString();
  const result: string[] = [];
  str.split('').reverse().forEach((digit, i) => {
    if (i > 0 && i % 3 === 0) result.push(' ');
    result.push(digit);
  });
  return result.reverse().join('');
};

export const formatGNF = (amount: number): string => `${formatNumber(amount)} GNF`;

// Live thousands-grouping for a money TextInput as the user types — direct
// request: raw digits ("1010000") are hard to read at a glance, and GNF has
// no subunit to reason about, so grouping is purely cosmetic (no decimal
// point to protect, unlike a currency with cents). Reuses formatNumber()'s
// own grouping logic rather than reimplementing it, so the two can never
// disagree — see components/ui/MoneyInput.tsx for the input component that
// wraps these two functions around a plain TextInput.
export const formatAmountInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return formatNumber(parseInt(digits, 10));
};

export const parseAmountInput = (formatted: string): number => {
  const digits = formatted.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
};

export const formatDate = (isoDate: string): string => {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
