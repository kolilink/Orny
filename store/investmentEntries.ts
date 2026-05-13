import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvestmentEntry } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_investment_entries`;

export const getInvestmentEntries = async (): Promise<InvestmentEntry[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as InvestmentEntry[]) : [];
};

export const getEntriesForInvestor = async (investorId: string): Promise<InvestmentEntry[]> => {
  const entries = await getInvestmentEntries();
  return entries.filter((e) => e.investorId === investorId);
};

export const addInvestmentEntry = async (
  entry: Omit<InvestmentEntry, 'id' | 'factory_id'>
): Promise<InvestmentEntry> => {
  const entries = await getInvestmentEntries();
  const newEntry: InvestmentEntry = {
    ...entry,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newEntry, ...entries]));
  return newEntry;
};

export const deleteInvestmentEntry = async (id: string): Promise<void> => {
  const entries = await getInvestmentEntries();
  await AsyncStorage.setItem(KEY, JSON.stringify(entries.filter((e) => e.id !== id)));
};

export const setInvestmentEntries = async (entries: InvestmentEntry[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
};
