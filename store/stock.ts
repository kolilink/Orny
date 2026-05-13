import AsyncStorage from '@react-native-async-storage/async-storage';
import { StockItem } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_stock`;

const STOCK_NAMES: Record<string, string> = {
  pommes_de_terre: 'Pommes de terre',
  huile: 'Huile',
  sachets_80g: 'Sachets 80g',
  gaz_lpg: 'Gaz LPG',
};

export const getStock = async (): Promise<StockItem[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as StockItem[]) : [];
};

export const initStock = async (levels: Record<string, number>): Promise<StockItem[]> => {
  const now = new Date().toISOString();
  const items: StockItem[] = Object.entries(FACTORY_CONFIG.stockAlerts).map(
    ([key, val]) => ({
      id: key,
      factory_id: FACTORY_CONFIG.id,
      name: STOCK_NAMES[key] ?? key,
      unit: val.unit,
      currentLevel: levels[key] ?? 0,
      alertThreshold: val.threshold,
      lastUpdated: now,
    })
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  return items;
};

export const updateStock = async (
  updates: Record<string, number>
): Promise<StockItem[]> => {
  const stock = await getStock();
  const now = new Date().toISOString();
  const updated = stock.map((item) =>
    updates[item.id] !== undefined
      ? { ...item, currentLevel: updates[item.id], lastUpdated: now }
      : item
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
  return updated;
};

export const addStockItem = async (
  item: Omit<StockItem, 'id' | 'factory_id' | 'lastUpdated'>
): Promise<StockItem> => {
  const stock = await getStock();
  const newItem: StockItem = {
    ...item,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
    lastUpdated: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([...stock, newItem]));
  return newItem;
};

export const deleteStockItem = async (id: string): Promise<void> => {
  const stock = await getStock();
  await AsyncStorage.setItem(KEY, JSON.stringify(stock.filter((i) => i.id !== id)));
};

export const deductStock = async (
  deductions: Record<string, number>
): Promise<void> => {
  const stock = await getStock();
  const now = new Date().toISOString();
  const updated = stock.map((item) =>
    deductions[item.id] !== undefined
      ? {
          ...item,
          currentLevel: Math.max(0, item.currentLevel - deductions[item.id]),
          lastUpdated: now,
        }
      : item
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};
