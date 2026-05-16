import AsyncStorage from '@react-native-async-storage/async-storage';
import { BulkProduct } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_bulks`; }

export const getBulks = async (): Promise<BulkProduct[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as BulkProduct[]) : [];
};

const setCache = async (bulks: BulkProduct[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(bulks));
};

export const syncBulksFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('bulk_products')
    .select('*')
    .eq('factory_id', factoryId);
  if (error || !data) return;
  const bulks: BulkProduct[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    flavorId: r.flavor_id,
    bagCount: r.bag_count,
    unitPrice: r.unit_price,
  }));
  await setCache(bulks);
};

export const addBulk = async (
  bulk: Omit<BulkProduct, 'id' | 'factory_id'>
): Promise<BulkProduct> => {
  const factoryId = getFactoryId();
  const newBulk: BulkProduct = { ...bulk, id: generateId(), factory_id: factoryId };
  const bulks = await getBulks();
  await setCache([newBulk, ...bulks]);

  supabase.from('bulk_products').insert({
    id: newBulk.id,
    factory_id: factoryId,
    name: newBulk.name,
    flavor_id: newBulk.flavorId ?? null,
    bag_count: newBulk.bagCount,
    unit_price: newBulk.unitPrice,
  }).then(({ error }) => { if (error) console.warn('bulks insert sync error', error.message); });

  return newBulk;
};

export const updateBulk = async (
  id: string,
  updates: Partial<Omit<BulkProduct, 'id' | 'factory_id'>>
): Promise<void> => {
  const bulks = await getBulks();
  await setCache(bulks.map((b) => (b.id === id ? { ...b, ...updates } : b)));

  const row: Record<string, unknown> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.flavorId !== undefined) row.flavor_id = updates.flavorId;
  if (updates.bagCount !== undefined) row.bag_count = updates.bagCount;
  if (updates.unitPrice !== undefined) row.unit_price = updates.unitPrice;

  supabase.from('bulk_products').update(row).eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('bulks update sync error', error.message); });
};

export const deleteBulk = async (id: string): Promise<void> => {
  const bulks = await getBulks();
  await setCache(bulks.filter((b) => b.id !== id));
  supabase.from('bulk_products').delete().eq('id', id).eq('factory_id', getFactoryId())
    .then(({ error }) => { if (error) console.warn('bulks delete sync error', error.message); });
};

export const setBulks = async (bulks: BulkProduct[]): Promise<void> => {
  await setCache(bulks);
};
