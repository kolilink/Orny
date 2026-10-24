// First test in this repo (there was no test suite, only `tsc --noEmit`).
// Plain asserts, no test framework yet: compile with tsc and run the
// output with node — a failure throws, a pass prints nothing except the
// final line. Convert to jest `describe/test` when a runner is added;
// the cases below must survive that conversion unchanged.
import { summarizeFactoryDay } from './factoryToday';

// Tiny assert shim (no @types/node in this repo, and no test framework
// yet) — throws on the first mismatch, so a silent run is a pass.
const assert = {
  strictEqual: (a: unknown, b: unknown, msg = '') => {
    if (a !== b) throw new Error(`expected ${String(b)}, got ${String(a)} ${msg}`);
  },
  deepStrictEqual: (a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    }
  },
};
import type { Sale, Batch, StockItem } from '../types';

const sale = (over: Partial<Sale>): Sale => ({
  id: 's1', factory_id: 'f1', date: '2026-10-24', clientName: 'Test',
  product: 'SOL 80g', quantity: 10, unitPrice: 1000, totalAmount: 10000,
  paymentMethod: 'cash', ...over,
});
const batch = (over: Partial<Batch>): Batch => ({
  id: 'b1', factory_id: 'f1', date: '2026-10-24', productId: 'p1',
  productName: 'SOL 80g', unitsProduced: 50, materialsUsed: [], createdAt: '2026-10-24T08:00:00Z', ...over,
});
const item = (over: Partial<StockItem>): StockItem => ({
  id: 'i1', factory_id: 'f1', name: 'SOL 80g', unit: 'sachet',
  currentLevel: 100, alertThreshold: 20, lastUpdated: '2026-10-24', ...over,
});

const s = summarizeFactoryDay(
  [
    sale({ quantity: 10, totalAmount: 10000, amountPaid: 10000 }), // today, cash, paid
    sale({ id: 's2', quantity: 5, totalAmount: 5000, paymentMethod: 'credit' }), // today, credit, nothing paid
    sale({ id: 's3', quantity: 4, totalAmount: 4000, paymentMethod: 'credit', amountPaid: 1000 }), // today, credit, partial
    sale({ id: 's4', date: '2026-10-23', quantity: 99, totalAmount: 99000, amountPaid: 99000 }), // yesterday: ignored
    sale({ id: 's5', quantity: 2, totalAmount: 2000, paymentMethod: 'orange_money' }), // no amountPaid, non-credit = fully paid
  ],
  [
    batch({ unitsProduced: 50 }),
    batch({ id: 'b2', date: '2026-10-23', unitsProduced: 999 }), // yesterday: ignored
  ],
  [
    item({ name: 'SOL 80g', currentLevel: 100, alertThreshold: 20 }),
    item({ id: 'i2', name: 'Pommes de terre', currentLevel: 5, alertThreshold: 20 }),
    item({ id: 'i3', name: 'Huile', currentLevel: 20, alertThreshold: 20 }), // at threshold = low
  ],
  3,
  '2026-10-24',
);

assert.strictEqual(s.todaySalesUnits, 10 + 5 + 4 + 2);
assert.strictEqual(s.todayCollectedGNF, 10000 + 0 + 1000 + 2000);
assert.strictEqual(s.todayProducedUnits, 50);
assert.strictEqual(s.lowStockCount, 2);
assert.deepStrictEqual(s.lowStockNames, ['Pommes de terre', 'Huile']);
assert.strictEqual(s.creditOutstandingGNF, 5000 + 3000);
assert.strictEqual(s.pendingSync, 3);

// Overpaid credit never goes negative, and stock units are never summed.
const s2 = summarizeFactoryDay(
  [sale({ paymentMethod: 'credit', totalAmount: 1000, amountPaid: 1500 })],
  [], [item({ currentLevel: 1, alertThreshold: 0 })], 0, '2026-10-24',
);
assert.strictEqual(s2.creditOutstandingGNF, 0);
assert.strictEqual(s2.lowStockCount, 0);

console.log('factoryToday: all assertions passed');
