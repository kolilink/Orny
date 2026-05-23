import AsyncStorage from '@react-native-async-storage/async-storage';
import { Batch } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { toDateString } from '../utils/dates';

function cacheKey() { return `${getFactoryId()}_batches_v2`; }

export const getBatches = async (): Promise<Batch[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Batch[]) : [];
};

const setCache = async (batches: Batch[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(batches));
};

export const addBatch = async (
  batch: Omit<Batch, 'id' | 'factory_id' | 'createdAt'>
): Promise<Batch> => {
  const factoryId = getFactoryId();
  const now = new Date().toISOString();
  const newBatch: Batch = { ...batch, id: generateId(), factory_id: factoryId, createdAt: now };
  const batches = await getBatches();
  await setCache([newBatch, ...batches]);

  supabase.from('production_batches_v2').insert({
    id: newBatch.id,
    factory_id: factoryId,
    date: newBatch.date,
    product_id: newBatch.productId,
    product_name: newBatch.productName,
    units_produced: newBatch.unitsProduced,
    materials_used: newBatch.materialsUsed,
    energy_used: newBatch.energyUsed ?? null,
    hours_worked: newBatch.hoursWorked ?? null,
    notes: newBatch.notes ?? null,
    created_at: now,
  }).then(({ error }) => { if (error) console.warn('batch insert sync error', error.message); });

  return newBatch;
};

export const getBatchesForProduct = async (productId: string): Promise<Batch[]> => {
  const batches = await getBatches();
  return batches.filter((b) => b.productId === productId);
};

export const getTodayBatches = async (): Promise<Batch[]> => {
  const today = toDateString();
  const batches = await getBatches();
  return batches.filter((b) => b.date === today);
};

export const syncBatchesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('production_batches_v2')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  const batches: Batch[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    date: r.date,
    productId: r.product_id,
    productName: r.product_name,
    unitsProduced: r.units_produced,
    materialsUsed: r.materials_used ?? [],
    energyUsed: r.energy_used ?? undefined,
    hoursWorked: r.hours_worked ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  }));
  await setCache(batches);
};
