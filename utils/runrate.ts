import { Batch, Sale, StockItem } from '../types';
import { daysAgo, toDateString } from './dates';

const WINDOW_DAYS = 14;

export interface StockRunrate {
  id: string;
  name: string;
  unit: string;
  currentLevel: number;
  /** Average units consumed per day over the trailing WINDOW_DAYS. */
  dailyConsumption: number;
  /** Projected days until this item hits zero at the current pace. Null = no
   *  recent consumption observed, so a projection wouldn't mean anything. */
  daysOfCover: number | null;
}

// Burn-rate is computed from gross consumption only (production draw-down +
// sales draw-down), never netted against purchases/restocks — currentLevel
// already reflects any restocking, so subtracting purchases from the
// consumption side would double-count and understate the true burn rate.
export function computeRunrates(stock: StockItem[], batches: Batch[], sales: Sale[]): StockRunrate[] {
  const windowStart = daysAgo(WINDOW_DAYS);
  const today = toDateString();

  const windowBatches = batches.filter(b => b.date >= windowStart && b.date <= today);
  const windowSales = sales.filter(s => s.date >= windowStart && s.date <= today);

  // Raw-material consumption is keyed by stock item id — materialsUsed[].rawMaterialId
  // is set from the recipe, which itself references the stock item id (see
  // store/products.ts's Product.lastRecipe / addStockItem in store/stock.ts).
  const consumptionById: Record<string, number> = {};
  windowBatches.forEach(b => {
    (b.materialsUsed ?? []).forEach(m => {
      if (!m.rawMaterialId) return;
      consumptionById[m.rawMaterialId] = (consumptionById[m.rawMaterialId] ?? 0) + m.quantity;
    });
  });

  // Finished-goods depletion has no such id to key on — Sale only carries the
  // product's display name (types/index.ts), not a stock item id — so this
  // side has to match by name instead.
  const consumptionByName: Record<string, number> = {};
  windowSales.forEach(s => {
    consumptionByName[s.product] = (consumptionByName[s.product] ?? 0) + s.quantity;
  });

  return stock.map(item => {
    const consumed = (consumptionById[item.id] ?? 0) + (consumptionByName[item.name] ?? 0);
    const dailyConsumption = Math.round((consumed / WINDOW_DAYS) * 100) / 100;
    const daysOfCover = dailyConsumption > 0 ? Math.floor(item.currentLevel / dailyConsumption) : null;

    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentLevel: item.currentLevel,
      dailyConsumption,
      daysOfCover,
    };
  });
}

// Items projected to run out soon at the current pace — the predictive
// counterpart to utils/notifications.ts's reactive threshold check
// (currentLevel <= alertThreshold). An item can pass this check well before
// it ever crosses its alert threshold, if it's being consumed fast.
export function projectedStockouts(runrates: StockRunrate[], withinDays = 5): StockRunrate[] {
  return runrates.filter(r => r.daysOfCover !== null && r.daysOfCover <= withinDays);
}
