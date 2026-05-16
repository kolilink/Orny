import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvestmentEntry } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_investment_entries`; }

export const getInvestmentEntries = async (): Promise<InvestmentEntry[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as InvestmentEntry[]) : [];
};

export const getEntriesForInvestor = async (investorId: string): Promise<InvestmentEntry[]> => {
  const entries = await getInvestmentEntries();
  return entries.filter((e) => e.investorId === investorId);
};

const setCache = async (entries: InvestmentEntry[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(entries));
};

export const syncInvestmentEntriesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('investment_entries')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  const entries: InvestmentEntry[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    investorId: r.investor_id,
    amount: r.amount,
    date: r.date,
    notes: r.notes,
  }));
  await setCache(entries);
};

export const addInvestmentEntry = async (
  entry: Omit<InvestmentEntry, 'id' | 'factory_id'>
): Promise<InvestmentEntry> => {
  const factoryId = getFactoryId();
  const newEntry: InvestmentEntry = { ...entry, id: generateId(), factory_id: factoryId };
  const entries = await getInvestmentEntries();
  await setCache([newEntry, ...entries]);

  supabase.from('investment_entries').insert({
    id: newEntry.id,
    factory_id: factoryId,
    investor_id: newEntry.investorId,
    amount: newEntry.amount,
    date: newEntry.date,
    notes: newEntry.notes ?? null,
  }).then(({ error }) => { if (error) console.warn('investment_entries insert sync error', error.message); });

  return newEntry;
};

export const deleteInvestmentEntry = async (id: string): Promise<void> => {
  const entries = await getInvestmentEntries();
  await setCache(entries.filter((e) => e.id !== id));
  supabase.from('investment_entries').delete().eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('investment_entries delete sync error', error.message); });
};

export const setInvestmentEntries = async (entries: InvestmentEntry[]): Promise<void> => {
  await setCache(entries);
};
