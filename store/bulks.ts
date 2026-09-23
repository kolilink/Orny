import AsyncStorage from '@react-native-async-storage/async-storage';
import { BulkProduct } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';
import { ensureStockItem } from './stock';

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
  let data, error;
  try {
    ({ data, error } = await withTimeout(supabase.from('bulk_products').select('*').eq('factory_id', factoryId)));
  } catch {
    return;
  }
  if (error || !data) return;
  const bulks: BulkProduct[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    flavorId: r.flavor_id,
    bagCount: r.bag_count,
    unitPrice: r.unit_price,
    recipePerUnit: r.recipe_per_unit ?? [],
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

  // A bulk tied to a flavor (a case of N bags of that flavor) has no stock
  // of its own — selling it deducts bagCount×qty from the flavor's stock.
  // A standalone bulk (no flavorId) needs its own finished-goods stock row.
  if (!newBulk.flavorId) {
    await ensureStockItem(newBulk.id, newBulk.name, 'unité');
  }

  const row = {
    id: newBulk.id,
    factory_id: factoryId,
    name: newBulk.name,
    flavor_id: newBulk.flavorId ?? null,
    bag_count: newBulk.bagCount,
    unit_price: newBulk.unitPrice,
    recipe_per_unit: [],
  };
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new bulk from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('bulk_products').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'bulk_products', op: 'insert', values: row, label: 'lot' });

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
  if (updates.recipePerUnit !== undefined) row.recipe_per_unit = updates.recipePerUnit;

  const factoryId = getFactoryId();
  const { error } = await supabase.from('bulk_products').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'bulk_products', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'lot (modif.)' });
};

export const deleteBulk = async (id: string): Promise<void> => {
  const bulks = await getBulks();
  await setCache(bulks.filter((b) => b.id !== id));
  const factoryId = getFactoryId();
  const { error } = await supabase.from('bulk_products').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'bulk_products', op: 'delete', match: { id, factory_id: factoryId }, label: 'lot (suppr.)' });
};

export const setBulks = async (bulks: BulkProduct[]): Promise<void> => {
  await setCache(bulks);
};
