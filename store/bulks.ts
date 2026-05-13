import AsyncStorage from '@react-native-async-storage/async-storage';
import { BulkProduct } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_bulks`;

export const getBulks = async (): Promise<BulkProduct[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as BulkProduct[]) : [];
};

export const addBulk = async (
  bulk: Omit<BulkProduct, 'id' | 'factory_id'>
): Promise<BulkProduct> => {
  const bulks = await getBulks();
  const newBulk: BulkProduct = {
    ...bulk,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newBulk, ...bulks]));
  return newBulk;
};

export const updateBulk = async (
  id: string,
  updates: Partial<Omit<BulkProduct, 'id' | 'factory_id'>>
): Promise<void> => {
  const bulks = await getBulks();
  const updated = bulks.map((b) => (b.id === id ? { ...b, ...updates } : b));
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};

export const deleteBulk = async (id: string): Promise<void> => {
  const bulks = await getBulks();
  await AsyncStorage.setItem(KEY, JSON.stringify(bulks.filter((b) => b.id !== id)));
};

export const setBulks = async (bulks: BulkProduct[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(bulks));
};
