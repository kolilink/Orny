import AsyncStorage from '@react-native-async-storage/async-storage';
import { StockItem } from '../types';
import { getFactoryId, generateId } from './context';
import { FACTORY_CONFIG } from '../config/factory';
import { supabase } from '../lib/supabase';

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

  supabase.from('stock_items').upsert(
    items.map((item) => ({
      id: item.id,
      factory_id: factoryId,
      name: item.name,
      unit: item.unit,
      current_level: item.currentLevel,
      alert_threshold: item.alertThreshold,
      last_updated: item.lastUpdated,
    }))
  ).then(({ error }) => { if (error) console.warn('stock init sync error', error.message); });

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
    supabase.from('stock_items').upsert(
      toSync.map((item) => ({
        id: item.id,
        factory_id: factoryId,
        name: item.name,
        unit: item.unit,
        current_level: item.currentLevel,
        alert_threshold: item.alertThreshold,
        last_updated: item.lastUpdated,
      }))
    ).then(({ error }) => { if (error) console.warn('stock update sync error', error.message); });
  }

  return updated;
};

export const addStockItem = async (
  item: Omit<StockItem, 'id' | 'factory_id' | 'lastUpdated'>
): Promise<StockItem> => {
  const factoryId = getFactoryId();
  const newItem: StockItem = { ...item, id: generateId(), factory_id: factoryId, lastUpdated: new Date().toISOString() };
  const stock = await getStock();
  await setCache([...stock, newItem]);

  supabase.from('stock_items').insert({
    id: newItem.id,
    factory_id: factoryId,
    name: newItem.name,
    unit: newItem.unit,
    current_level: newItem.currentLevel,
    alert_threshold: newItem.alertThreshold,
    last_updated: newItem.lastUpdated,
  }).then(({ error }) => { if (error) console.warn('stock add sync error', error.message); });

  return newItem;
};

export const deleteStockItem = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const stock = await getStock();
  await setCache(stock.filter((i) => i.id !== id));
  supabase.from('stock_items').delete().eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('stock delete sync error', error.message); });
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
    supabase.from('stock_items').upsert(
      toSync.map((item) => ({
        id: item.id,
        factory_id: factoryId,
        name: item.name,
        unit: item.unit,
        current_level: item.currentLevel,
        alert_threshold: item.alertThreshold,
        last_updated: item.lastUpdated,
      }))
    ).then(({ error }) => { if (error) console.warn('stock deduct sync error', error.message); });
  }
};
