import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sale } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_sales`;

export const getSales = async (): Promise<Sale[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as Sale[]) : [];
};

export const addSale = async (
  sale: Omit<Sale, 'id' | 'factory_id'>
): Promise<Sale> => {
  const sales = await getSales();
  const newSale: Sale = {
    ...sale,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newSale, ...sales]));
  return newSale;
};

export const updateSale = async (
  id: string,
  updates: Partial<Omit<Sale, 'id' | 'factory_id'>>
): Promise<void> => {
  const sales = await getSales();
  const updated = sales.map((s) => (s.id === id ? { ...s, ...updates } : s));
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};

export const deleteSale = async (id: string): Promise<void> => {
  const sales = await getSales();
  await AsyncStorage.setItem(KEY, JSON.stringify(sales.filter((s) => s.id !== id)));
};

export const setSales = async (sales: Sale[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(sales));
};
