// "Comment ça va, l'usine ?" — from first principles.
//
// The only question a factory owner in Guinea needs answered on opening
// the app is: what happened today, what do we have left, and who still
// owes us? No charts, no trends, no jargon. Four numbers, in plain French.
//
// This module is PURE: it takes already-loaded rows and a date string and
// returns the summary. It makes no network call, reads no storage, and
// touches no UI, so it can be tested without a phone, a Supabase project,
// or a network connection. The screen that uses it (screens/Today) reads
// only the on-device cache, so the first paint is instant even offline —
// the same offline-first shape Patron uses: paint from cache, sync later.
//
// Money rules, stated plainly so they can be challenged:
// - A sale counts as "today" when its `date` equals the given day.
// - "Encaissé" is what was actually paid. When amountPaid is missing we
//   do NOT invent it: cash / Orange Money sales count as fully paid
//   (that is what those payment methods mean), credit sales count as
//   0 paid until a payment is recorded.
// - "À récupérer" counts ONLY credit sales, as total minus amountPaid,
//   floored at 0. A cash sale never shows up as owed money.
// - Stock is never summed across units (kg of potatoes + sachets would be
//   a meaningless number). Instead we report how many stock items are at
//   or below their own alert threshold, with their names.
import type { Sale, Batch, StockItem } from '../types';

export interface FactoryDaySummary {
  todaySalesUnits: number;
  todayCollectedGNF: number;
  todayProducedUnits: number;
  lowStockCount: number;
  lowStockNames: string[];
  creditOutstandingGNF: number;
  pendingSync: number;
}

export function summarizeFactoryDay(
  sales: Sale[],
  batches: Batch[],
  stock: StockItem[],
  pendingSync: number,
  today: string,
): FactoryDaySummary {
  let todaySalesUnits = 0;
  let todayCollectedGNF = 0;
  for (const sale of sales) {
    if (sale.date !== today) continue;
    todaySalesUnits += sale.quantity ?? 0;
    if (sale.amountPaid !== undefined && sale.amountPaid !== null) {
      todayCollectedGNF += sale.amountPaid;
    } else if (sale.paymentMethod !== 'credit') {
      todayCollectedGNF += sale.totalAmount ?? 0;
    }
  }

  let todayProducedUnits = 0;
  for (const batch of batches) {
    if (batch.date !== today) continue;
    todayProducedUnits += batch.unitsProduced ?? 0;
  }

  const lowStock = stock.filter(
    (item) => (item.currentLevel ?? 0) <= (item.alertThreshold ?? 0),
  );

  let creditOutstandingGNF = 0;
  for (const sale of sales) {
    if (sale.paymentMethod !== 'credit') continue;
    const owed = (sale.totalAmount ?? 0) - (sale.amountPaid ?? 0);
    if (owed > 0) creditOutstandingGNF += owed;
  }

  return {
    todaySalesUnits,
    todayCollectedGNF,
    todayProducedUnits,
    lowStockCount: lowStock.length,
    lowStockNames: lowStock.map((item) => item.name),
    creditOutstandingGNF,
    pendingSync,
  };
}
