// Drain scenarios for lib/syncQueue.ts, run against the COMPILED queue
// module (not the TypeScript source) with stubbed dependencies.
//
// Usage (from the repo root, after `npm install` so `tsc` exists):
//   npx tsc lib/syncQueue.ts lib/withTimeout.ts store/context.ts \
//     --module commonjs --target es2020 --moduleResolution node \
//     --outDir /tmp/orny-tests-out --skipLibCheck
//   node tests/syncQueue.drain.test.cjs /tmp/orny-tests-out
//
// The harness overwrites the compiled lib/supabase.js with a controllable
// fake and installs an in-memory AsyncStorage under the compiled output's
// node_modules, then requires the compiled queue. No phone, no network,
// no Supabase project. A failure throws; a pass prints the final line.
//
// Scenarios:
//  1. Network failure enqueues, non-network failure throws and is NOT queued.
//  2. Drain with success syncs everything, pending = 0.
//  3. Drain with a network failure stops at that item and keeps the rest.
//  4. Drain with a business failure retries, then dead-letters after 5
//     attempts instead of silently dropping the write.
//  5. A hanging (never-resolving) write times out at 12s and stays queued
//     — this scenario takes ~12s by design.
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node tests/syncQueue.drain.test.cjs <compiled-output-dir>');
  process.exit(2);
}
const libDir = path.join(outDir, 'lib');

// --- Fake Supabase: controllable per scenario -------------------------
const fakeSupabasePath = path.join(libDir, 'supabase.js');
fs.writeFileSync(
  fakeSupabasePath,
  `'use strict';
let mode = 'success'; // success | network | business | hang
let calls = 0;
class Builder {
  constructor() { this._error = null; }
  _setError() {
    if (mode === 'network') this._error = new Error('Network request failed');
    else if (mode === 'business') this._error = new Error('new row violates row-level security policy');
    else this._error = null;
  }
  insert() { this._setError(); calls++; if (mode === 'hang') return new Promise(() => {}); return Promise.resolve({ error: this._error }); }
  upsert() { this._setError(); calls++; if (mode === 'hang') return new Promise(() => {}); return Promise.resolve({ error: this._error }); }
  update() { this._setError(); calls++; return this; }
  delete() { this._setError(); calls++; return this; }
  eq() { return this; }
  then(resolve) {
    if (mode === 'hang') return new Promise(() => {}); // never resolves
    resolve({ error: this._error });
  }
}
const supabase = { from: () => new Builder(), __setMode: (m) => { mode = m; }, __calls: () => calls, __resetCalls: () => { calls = 0; } };
module.exports = { supabase };
`
);

// --- Fake AsyncStorage: in-memory --------------------------------------
const storageDir = path.join(outDir, 'node_modules', '@react-native-async-storage', 'async-storage');
fs.mkdirSync(storageDir, { recursive: true });
fs.writeFileSync(
  path.join(storageDir, 'package.json'),
  JSON.stringify({ name: '@react-native-async-storage/async-storage', main: 'index.js' })
);
fs.writeFileSync(
  path.join(storageDir, 'index.js'),
  `'use strict';
const store = new Map();
const api = {
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  setItem: async (k, v) => { store.set(k, v); },
  removeItem: async (k) => { store.delete(k); },
  __clear: () => store.clear(),
  __dump: () => Object.fromEntries(store),
};
module.exports = api;
module.exports.default = api;
`
);

const assert = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
};
const eq = (a, b, label) => {
  if (a !== b) throw new Error(`FAILED: ${label}: expected ${b}, got ${a}`);
};

(async () => {
  const queue = require(path.join(libDir, 'syncQueue.js'));
  const fakeSupabase = require(fakeSupabasePath).supabase;
  const storage = require(path.join(storageDir, 'index.js'));
  const item = (label) => ({ table: 'sales', op: 'insert', values: { id: '1' }, label });

  // 1. Enqueue classification
  storage.__clear();
  await queue.enqueueIfNetworkError(new Error('Network request failed'), item('vente'));
  eq(await queue.getPendingCount(), 1, 'network failure queues');
  let threw = false;
  try {
    await queue.enqueueIfNetworkError(new Error('RLS policy'), item('vente2'));
  } catch { threw = true; }
  assert(threw, 'business failure throws');
  eq(await queue.getPendingCount(), 1, 'business failure is NOT queued');

  // 2. Drain success
  fakeSupabase.__setMode('success');
  const r2 = await queue.drainSyncQueue();
  eq(r2.synced, 1, 'drain success synced');
  eq(r2.pending, 0, 'drain success pending 0');

  // 3. Drain network failure stops and preserves the queue
  storage.__clear();
  await queue.enqueueIfNetworkError(new Error('Network request failed'), item('a'));
  await queue.enqueueIfNetworkError(new Error('Network request failed'), item('b'));
  fakeSupabase.__setMode('network');
  const r3 = await queue.drainSyncQueue();
  eq(r3.synced, 0, 'network drain synced 0');
  eq(r3.pending, 2, 'network drain keeps both items');

  // 4. Business failure: retries, then dead-letters (5 attempts total:
  //    the initial enqueue is attempt 0, drains increment to 5)
  fakeSupabase.__setMode('business');
  let pending = 2;
  for (let i = 0; i < 6; i++) {
    const r = await queue.drainSyncQueue();
    pending = r.pending;
    if (pending === 0) break;
  }
  eq(pending, 0, 'business items leave the pending queue after exhaustion');
  eq(await queue.getDeadCount(), 2, 'business items move to dead list, not dropped');

  // 5. Hang: 12s timeout, item stays queued
  storage.__clear();
  await queue.enqueueIfNetworkError(new Error('Network request failed'), item('hang'));
  fakeSupabase.__setMode('hang');
  const start = Date.now();
  const r5 = await queue.drainSyncQueue();
  const elapsed = Date.now() - start;
  assert(elapsed >= 11000 && elapsed < 30000, `hang drain should take ~12s, took ${elapsed}ms`);
  eq(r5.pending, 1, 'hanging write stays queued after timeout');

  // --- Store writes: sales + stock, the two daily factory paths --------
  // These are the writes dad will actually make on the factory floor.
  // They must be visible locally even when the network fails, queued
  // for later, and replayed on drain — never lost, never duplicated
  // into a second local copy.
  const context = require(path.join(outDir, 'store', 'context.js'));
  const sales = require(path.join(outDir, 'store', 'sales.js'));
  const stock = require(path.join(outDir, 'store', 'stock.js'));
  context.setCurrentFactory('factory1');
  const saleInput = {
    date: '2026-10-24', clientName: 'Test', product: 'SOL 80g',
    quantity: 10, unitPrice: 1000, totalAmount: 10000, amountPaid: 10000,
    paymentMethod: 'cash',
  };

  // Sale, online: cached + synced, nothing queued.
  storage.__clear();
  fakeSupabase.__setMode('success');
  const made = await sales.addSale(saleInput);
  assert(made.id, 'addSale returns an id');
  eq((await sales.getSales()).length, 1, 'online sale is cached');
  eq((await sales.getSales())[0].quantity, 10, 'online sale quantity');
  eq(await queue.getPendingCount(), 0, 'online sale queues nothing');

  // Sale, offline: still cached (dad sees it immediately), queued once.
  fakeSupabase.__setMode('network');
  const madeOffline = await sales.addSale({ ...saleInput, quantity: 5, totalAmount: 5000, amountPaid: 0, paymentMethod: 'credit' });
  eq((await sales.getSales()).length, 2, 'offline sale is still cached');
  eq(await queue.getPendingCount(), 1, 'offline sale queues exactly once');

  // Back online: drain replays the queued sale, no duplicate local copy.
  fakeSupabase.__setMode('success');
  await queue.drainSyncQueue();
  eq(await queue.getPendingCount(), 0, 'drain clears the queued sale');
  eq((await sales.getSales()).length, 2, 'drain does not duplicate the local sale');

  // Update + delete, online: cache follows the change.
  await sales.updateSale(made.id, { quantity: 12 });
  eq((await sales.getSales()).find((s) => s.id === made.id).quantity, 12, 'updateSale changes the cache');
  await sales.deleteSale(madeOffline.id);
  eq((await sales.getSales()).length, 1, 'deleteSale removes from cache');

  // Stock deduction, online then offline.
  const stockKey = 'factory1_stock';
  await storage.setItem(stockKey, JSON.stringify([
    { id: 'SOL 80g', factory_id: 'factory1', name: 'SOL 80g', unit: 'sachet', currentLevel: 100, alertThreshold: 20, lastUpdated: '2026-10-24' },
  ]));
  fakeSupabase.__setMode('success');
  await stock.deductStock({ 'SOL 80g': 10 });
  eq((await stock.getStock())[0].currentLevel, 90, 'online deduction reduces cache');
  eq(await queue.getPendingCount(), 0, 'online deduction queues nothing');
  fakeSupabase.__setMode('network');
  await stock.deductStock({ 'SOL 80g': 5 });
  eq((await stock.getStock())[0].currentLevel, 85, 'offline deduction still reduces cache');
  eq(await queue.getPendingCount(), 1, 'offline deduction queues once');
  fakeSupabase.__setMode('success');
  await queue.drainSyncQueue();
  eq(await queue.getPendingCount(), 0, 'drain clears the queued deduction');

  console.log('syncQueue (drain) + store writes: all scenarios passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
