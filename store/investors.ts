import AsyncStorage from '@react-native-async-storage/async-storage';
import { Investor } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_investors`;

export const getInvestors = async (): Promise<Investor[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as Investor[]) : [];
};

export const addInvestor = async (
  investor: Omit<Investor, 'id' | 'factory_id' | 'dateAdded'>
): Promise<Investor> => {
  const investors = await getInvestors();
  const newInvestor: Investor = {
    ...investor,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
    dateAdded: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newInvestor, ...investors]));
  return newInvestor;
};

export const updateInvestor = async (
  id: string,
  updates: Partial<Omit<Investor, 'id' | 'factory_id'>>
): Promise<void> => {
  const investors = await getInvestors();
  const updated = investors.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv));
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};

export const deleteInvestor = async (id: string): Promise<void> => {
  const investors = await getInvestors();
  await AsyncStorage.setItem(KEY, JSON.stringify(investors.filter((inv) => inv.id !== id)));
};

export const setInvestors = async (investors: Investor[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(investors));
};
