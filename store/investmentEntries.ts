import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvestmentEntry, EditHistoryEntry } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';

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

  const row = {
    id: newEntry.id,
    factory_id: factoryId,
    investor_id: newEntry.investorId,
    amount: newEntry.amount,
    date: newEntry.date,
    notes: newEntry.notes ?? null,
    created_at: now,
  };
  // Awaited — see the identical note in store/investors.ts's addInvestor:
  // a fire-and-forget insert here races the caller's immediate post-add
  // re-sync and can lose the new entry from view even though it lands fine
  // in Postgres.
  const { error } = await supabase.from('investment_entries').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'investment_entries', op: 'insert', values: row, label: 'versement investisseur' });

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
  const factoryId = getFactoryId();
  const { error } = await supabase.from('investment_entries').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'investment_entries', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'versement investisseur (modif.)' });
};

export const deleteInvestmentEntry = async (id: string): Promise<void> => {
  const entries = await getInvestmentEntries();
  await setCache(entries.filter((e) => e.id !== id));
  const factoryId = getFactoryId();
  const { error } = await supabase.from('investment_entries').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'investment_entries', op: 'delete', match: { id, factory_id: factoryId }, label: 'versement investisseur (suppr.)' });
};

export const setInvestmentEntries = async (entries: InvestmentEntry[]): Promise<void> => {
  await setCache(entries);
};

// Append-only edit history, written automatically by a DB trigger on every
// UPDATE to this entry — see db/update15.sql. Always reads live (no local
// cache): this is meant to be trustworthy, not fast.
export const getEntryEditHistory = async (entryId: string): Promise<EditHistoryEntry<Partial<InvestmentEntry>>[]> => {
  const { data, error } = await supabase
    .from('investment_entry_edits')
    .select('*')
    .eq('entry_id', entryId)
    .order('edited_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    editedBy: r.edited_by ?? undefined,
    editedAt: r.edited_at,
    before: r.before,
    after: r.after,
  }));
};
