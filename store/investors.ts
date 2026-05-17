import AsyncStorage from '@react-native-async-storage/async-storage';
import { Investor } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_investors`; }

export const getInvestors = async (): Promise<Investor[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Investor[]) : [];
};

const setCache = async (investors: Investor[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(investors));
};

export const syncInvestorsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('investors')
    .select('*')
    .eq('factory_id', factoryId);
  if (error || !data) return;
  const investors: Investor[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    amountInvested: r.amount_invested,
    sharePercentage: r.share_percentage,
    dateAdded: r.date_added,
    notes: r.notes,
    userId: r.user_id ?? undefined,
  }));
  await setCache(investors);
};

export const addInvestor = async (
  investor: Omit<Investor, 'id' | 'factory_id' | 'dateAdded'>
): Promise<Investor> => {
  const factoryId = getFactoryId();
  const newInvestor: Investor = {
    ...investor,
    id: generateId(),
    factory_id: factoryId,
    dateAdded: new Date().toISOString(),
  };
  const investors = await getInvestors();
  await setCache([newInvestor, ...investors]);

  supabase.from('investors').insert({
    id: newInvestor.id,
    factory_id: factoryId,
    name: newInvestor.name,
    amount_invested: newInvestor.amountInvested,
    share_percentage: newInvestor.sharePercentage,
    date_added: newInvestor.dateAdded,
    notes: newInvestor.notes ?? null,
    user_id: newInvestor.userId ?? null,
  }).then(({ error }) => { if (error) console.warn('investors insert sync error', error.message); });

  return newInvestor;
};

export const updateInvestor = async (
  id: string,
  updates: Partial<Omit<Investor, 'id' | 'factory_id'>>
): Promise<void> => {
  const investors = await getInvestors();
  await setCache(investors.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv)));

  const row: Record<string, unknown> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.amountInvested !== undefined) row.amount_invested = updates.amountInvested;
  if (updates.sharePercentage !== undefined) row.share_percentage = updates.sharePercentage;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.userId !== undefined) row.user_id = updates.userId ?? null;

  supabase.from('investors').update(row).eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('investors update sync error', error.message); });
};

export const deleteInvestor = async (id: string): Promise<void> => {
  const investors = await getInvestors();
  await setCache(investors.filter((inv) => inv.id !== id));
  supabase.from('investors').delete().eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('investors delete sync error', error.message); });
};

export const setInvestors = async (investors: Investor[]): Promise<void> => {
  await setCache(investors);
};
