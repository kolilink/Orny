// One canonical definition of "is this stock level low/critical," shared by
// every screen and background check that needs it. Before this existed, four
// different places (screens/Stock, screens/Ventes, utils/notifications,
// utils/businessData) each hand-rolled their own comparison, and they didn't
// agree: Stock's own screen used `currentLevel < alertThreshold` (strict, no
// separate zero-check) for "critical" plus an extra `* 1.2` cushion for
// "low," while the other three used `<= 0` for critical and `<= threshold`
// for low — so an item sitting exactly at its threshold read as "low"
// everywhere except the Stock screen, and for a different reason than the
// other three even where the label agreed. Any future alert/threshold logic
// should read from here instead of writing a fifth variant.
export type StockSeverity = 'critical' | 'low' | 'ok';

export function stockSeverity(currentLevel: number, alertThreshold: number): StockSeverity {
  if (currentLevel <= 0) return 'critical';
  if (currentLevel <= alertThreshold) return 'low';
  return 'ok';
}
