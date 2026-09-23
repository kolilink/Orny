import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvestorDistribution } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';

function cacheKey() { return `${getFactoryId()}_investor_distributions`; }

export const getDistributions = async (): Promise<InvestorDistribution[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as InvestorDistribution[]) : [];
};

export const getDistributionsForInvestor = async (investorId: string): Promise<InvestorDistribution[]> => {
  const dists = await getDistributions();
  return dists.filter((d) => d.investorId === investorId);
};

const setCache = async (dists: InvestorDistribution[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(dists));
};

export const syncDistributionsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('investor_distributions').select('*').eq('factory_id', factoryId).order('created_at', { ascending: false })
    ));
  } catch {
    return;
  }
  if (error || !data) return;
  const dists: InvestorDistribution[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    investorId: r.investor_id,
    amount: r.amount,
    date: r.date,
    notes: r.notes,
    createdAt: r.created_at ?? undefined,
  }));
  await setCache(dists);
};

export const addDistribution = async (
  dist: Omit<InvestorDistribution, 'id' | 'factory_id' | 'createdAt'>
): Promise<InvestorDistribution> => {
  const factoryId = getFactoryId();
  const now = new Date().toISOString();
  const newDist: InvestorDistribution = { ...dist, id: generateId(), factory_id: factoryId, createdAt: now };
  const dists = await getDistributions();
  await setCache([newDist, ...dists]);

  const row = {
    id: newDist.id,
    factory_id: factoryId,
    investor_id: newDist.investorId,
    amount: newDist.amount,
    date: newDist.date,
    notes: newDist.notes ?? null,
    created_at: now,
  };
  // Awaited — see the identical note in store/investors.ts's addInvestor:
  // a fire-and-forget insert here races the caller's immediate post-add
  // re-sync and can lose the new distribution from view even though it
  // lands fine in Postgres.
  const { error } = await supabase.from('investor_distributions').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'investor_distributions', op: 'insert', values: row, label: 'distribution investisseur' });

  return newDist;
};

export const deleteDistribution = async (id: string): Promise<void> => {
  const dists = await getDistributions();
  await setCache(dists.filter((d) => d.id !== id));
  const factoryId = getFactoryId();
  const { error } = await supabase.from('investor_distributions').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'investor_distributions', op: 'delete', match: { id, factory_id: factoryId }, label: 'distribution investisseur (suppr.)' });
};

export const setDistributions = async (dists: InvestorDistribution[]): Promise<void> => {
  await setCache(dists);
};
