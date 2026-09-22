import AsyncStorage from '@react-native-async-storage/async-storage';
import { StockItem } from '../types';
import { getFactoryId, generateId } from './context';
import { FACTORY_CONFIG } from '../config/factory';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';

function cacheKey() { return `${getFactoryId()}_stock`; }

const STOCK_NAMES: Record<string, string> = {
  pommes_de_terre: 'Matière première',
  huile: 'Matière 2',
  sachets_80g: 'Produit fini',
  gaz_lpg: 'Énergie',
};

export const getStock = async (): Promise<StockItem[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as StockItem[]) : [];
};

const setCache = async (items: StockItem[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(items));
};

export const syncStockFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .eq('factory_id', factoryId);
  if (error || !data) return;
  const items: StockItem[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    unit: r.unit,
    currentLevel: r.current_level,
    alertThreshold: r.alert_threshold,
    lastUpdated: r.last_updated,
    avgCost: r.avg_cost ?? 0,
  }));
  await setCache(items);
};

export const initStock = async (levels: Record<string, number>): Promise<StockItem[]> => {
  const factoryId = getFactoryId();
  const now = new Date().toISOString();
  const items: StockItem[] = Object.entries(FACTORY_CONFIG.stockAlerts).map(([key, val]) => ({
    id: key,
    factory_id: factoryId,
    name: STOCK_NAMES[key] ?? key,
    unit: val.unit,
    currentLevel: levels[key] ?? 0,
    alertThreshold: val.threshold,
    lastUpdated: now,
  }));
  await setCache(items);

  const rows = items.map((item) => ({
    id: item.id,
    factory_id: factoryId,
    name: item.name,
    unit: item.unit,
    current_level: item.currentLevel,
    alert_threshold: item.alertThreshold,
    last_updated: item.lastUpdated,
  }));
  // Awaited — a fire-and-forget write here races a caller's immediate
  // post-write reload/re-sync and can lose the update from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('stock_items').upsert(rows);
  if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'upsert', values: rows, label: 'stock (init)' });

  return items;
};

export const updateStock = async (updates: Record<string, number>): Promise<StockItem[]> => {
  const factoryId = getFactoryId();
  const stock = await getStock();
  const now = new Date().toISOString();
  const updated = stock.map((item) =>
    updates[item.id] !== undefined
      ? { ...item, currentLevel: updates[item.id], lastUpdated: now }
      : item
  );
  await setCache(updated);

  const toSync = updated.filter((item) => updates[item.id] !== undefined);
  if (toSync.length > 0) {
    const rows = toSync.map((item) => ({
      id: item.id,
      factory_id: factoryId,
      name: item.name,
      unit: item.unit,
      current_level: item.currentLevel,
      alert_threshold: item.alertThreshold,
      last_updated: item.lastUpdated,
    }));
    const { error } = await supabase.from('stock_items').upsert(rows);
    if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'upsert', values: rows, label: 'stock (mise à jour)' });
  }

  return updated;
};

export const addStockItem = async (
  item: Omit<StockItem, 'id' | 'factory_id' | 'lastUpdated'> & { id?: string }
): Promise<StockItem> => {
  const factoryId = getFactoryId();
  const newItem: StockItem = { ...item, id: item.id ?? generateId(), factory_id: factoryId, lastUpdated: new Date().toISOString() };
  const stock = await getStock();
  await setCache([...stock, newItem]);

  const row = {
    id: newItem.id,
    factory_id: factoryId,
    name: newItem.name,
    unit: newItem.unit,
    current_level: newItem.currentLevel,
    alert_threshold: newItem.alertThreshold,
    last_updated: newItem.lastUpdated,
  };
  const { error } = await supabase.from('stock_items').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'insert', values: row, label: 'stock (ajout)' });

  return newItem;
};

export const deleteStockItem = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const stock = await getStock();
  await setCache(stock.filter((i) => i.id !== id));
  const { error } = await supabase.from('stock_items').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'delete', match: { id, factory_id: factoryId }, label: 'stock (suppr.)' });
};

export type StockShortfall = { id: string; name: string; unit: string; available: number; needed: number };

// Checks whether current stock covers the requested deductions, without
// mutating anything. Callers (Ventes, Production) use this to warn/confirm
// BEFORE committing a sale or batch that would run stock past zero.
export const checkStockAvailability = async (
  deductions: Record<string, number>
): Promise<StockShortfall[]> => {
  const stock = await getStock();
  const shortfalls: StockShortfall[] = [];
  for (const [id, needed] of Object.entries(deductions)) {
    if (needed <= 0) continue;
    const item = stock.find((s) => s.id === id);
    const available = item?.currentLevel ?? 0;
    if (available < needed) {
      shortfalls.push({ id, name: item?.name ?? id, unit: item?.unit ?? '', available, needed });
    }
  }
  return shortfalls;
};

// Idempotent: creates a finished-goods stock row for a sellable item
// (a Flavor or a standalone Bulk) if one doesn't already exist yet.
// Used both when the item is first created and as self-healing backfill
// for items that predate stock tracking being wired up.
export const ensureStockItem = async (
  id: string,
  name: string,
  unit: string
): Promise<void> => {
  const stock = await getStock();
  if (stock.some((s) => s.id === id)) return;
  await addStockItem({ id, name, unit, currentLevel: 0, alertThreshold: 0 });
};

export const deductStock = async (deductions: Record<string, number>): Promise<void> => {
  const factoryId = getFactoryId();
  const stock = await getStock();
  const now = new Date().toISOString();
  const updated = stock.map((item) =>
    deductions[item.id] !== undefined
      ? { ...item, currentLevel: Math.max(0, item.currentLevel - deductions[item.id]), lastUpdated: now }
      : item
  );
  await setCache(updated);

  const toSync = updated.filter((item) => deductions[item.id] !== undefined);
  if (toSync.length > 0) {
    const rows = toSync.map((item) => ({
      id: item.id,
      factory_id: factoryId,
      name: item.name,
      unit: item.unit,
      current_level: item.currentLevel,
      alert_threshold: item.alertThreshold,
      last_updated: item.lastUpdated,
    }));
    const { error } = await supabase.from('stock_items').upsert(rows);
    if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'upsert', values: rows, label: 'stock (déduction)' });
  }
};

// Weighted-average cost: call this whenever stock increases from a costed
// source — a purchase, or a production batch adding finished goods costed
// from the raw materials it consumed. Consuming stock (a sale, a batch's
// own raw-material draw-down) never touches avgCost; WAC only moves on
// additions. This is what lets Reports compute real cost of goods sold
// instead of expensing a purchase in the month it happened to be bought.
export const recordStockAddition = async (id: string, qtyAdded: number, unitCost: number): Promise<void> => {
  if (qtyAdded <= 0) return;
  const factoryId = getFactoryId();
  const stock = await getStock();
  const now = new Date().toISOString();
  const updated = stock.map((item) => {
    if (item.id !== id) return item;
    const priorQty = item.currentLevel;
    const priorCost = item.avgCost ?? 0;
    const newQty = priorQty + qtyAdded;
    const newAvgCost = newQty > 0 ? (priorQty * priorCost + qtyAdded * unitCost) / newQty : 0;
    return { ...item, currentLevel: newQty, avgCost: newAvgCost, lastUpdated: now };
  });
  await setCache(updated);

  const item = updated.find((i) => i.id === id);
  if (!item) return;
  const row = {
    id: item.id,
    factory_id: factoryId,
    name: item.name,
    unit: item.unit,
    current_level: item.currentLevel,
    alert_threshold: item.alertThreshold,
    last_updated: item.lastUpdated,
    avg_cost: item.avgCost,
  };
  const { error } = await supabase.from('stock_items').upsert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'stock_items', op: 'upsert', values: row, label: 'stock (coût)' });
};
