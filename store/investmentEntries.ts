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
    createdAt: r.created_at ?? undefined,
  }));
  await setCache(entries);
};

export const addInvestmentEntry = async (
  entry: Omit<InvestmentEntry, 'id' | 'factory_id' | 'createdAt'>
): Promise<InvestmentEntry> => {
  const factoryId = getFactoryId();
  const now = new Date().toISOString();
  const newEntry: InvestmentEntry = { ...entry, id: generateId(), factory_id: factoryId, createdAt: now };
  const entries = await getInvestmentEntries();
  await setCache([newEntry, ...entries]);

  supabase.from('investment_entries').insert({
    id: newEntry.id,
    factory_id: factoryId,
    investor_id: newEntry.investorId,
    amount: newEntry.amount,
    date: newEntry.date,
    notes: newEntry.notes ?? null,
    created_at: now,
  }).then(({ error }) => { if (error) console.warn('investment_entries insert sync error', error.message); });

  return newEntry;
};

export const updateInvestmentEntry = async (
  id: string,
  updates: Partial<Pick<InvestmentEntry, 'amount' | 'date' | 'notes'>>
): Promise<void> => {
  const entries = await getInvestmentEntries();
  await setCache(entries.map(e => e.id === id ? { ...e, ...updates } : e));
  const row: Record<string, unknown> = {};
  if (updates.amount !== undefined) row.amount = updates.amount;
  if (updates.date !== undefined) row.date = updates.date;
  if (updates.notes !== undefined) row.notes = updates.notes ?? null;
  supabase.from('investment_entries').update(row).eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('investment_entries update sync error', error.message); });
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
