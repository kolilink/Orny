import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProductionBatch } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_production`; }

export const getBatches = async (): Promise<ProductionBatch[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as ProductionBatch[]) : [];
};

const setCache = async (batches: ProductionBatch[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(batches));
};

export const syncProductionFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('production_batches')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  const batches: ProductionBatch[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    date: r.date,
    potatoesUsedKg: r.potatoes_used_kg,
    sachets80g: r.sachets_80g,
    gasUsedKg: r.gas_used_kg,
    hoursWorked: r.hours_worked,
    yieldGramsPerKg: r.yield_grams_per_kg,
    extraMaterials: r.extra_materials,
  }));
  await setCache(batches);
};

export const addBatch = async (
  batch: Omit<ProductionBatch, 'id' | 'factory_id' | 'yieldGramsPerKg'>
): Promise<ProductionBatch> => {
  const factoryId = getFactoryId();
  const yieldGramsPerKg = batch.potatoesUsedKg > 0
    ? (batch.sachets80g * 80) / batch.potatoesUsedKg
    : 0;
  const newBatch: ProductionBatch = { ...batch, id: generateId(), factory_id: factoryId, yieldGramsPerKg };
  const batches = await getBatches();
  await setCache([newBatch, ...batches]);

  supabase.from('production_batches').insert({
    id: newBatch.id,
    factory_id: factoryId,
    date: newBatch.date,
    potatoes_used_kg: newBatch.potatoesUsedKg,
    sachets_80g: newBatch.sachets80g,
    gas_used_kg: newBatch.gasUsedKg,
    hours_worked: newBatch.hoursWorked,
    yield_grams_per_kg: newBatch.yieldGramsPerKg,
    extra_materials: newBatch.extraMaterials ?? null,
  }).then(({ error }) => { if (error) console.warn('production insert sync error', error.message); });

  return newBatch;
};

export const setBatches = async (batches: ProductionBatch[]): Promise<void> => {
  await setCache(batches);
};
