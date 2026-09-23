import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProductFlavor } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';
import { ensureStockItem } from './stock';

function cacheKey() { return `${getFactoryId()}_flavors`; }

export const getFlavors = async (): Promise<ProductFlavor[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as ProductFlavor[]) : [];
};

const setCache = async (flavors: ProductFlavor[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(flavors));
};

export const syncFlavorsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  let data, error;
  try {
    ({ data, error } = await withTimeout(supabase.from('product_flavors').select('*').eq('factory_id', factoryId)));
  } catch {
    return;
  }
  if (error || !data) return;
  const flavors: ProductFlavor[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    label: r.label,
    weightG: r.weight_g,
    defaultPrice: r.default_price,
    recipePerUnit: r.recipe_per_unit ?? [],
  }));
  await setCache(flavors);
};

export const addFlavor = async (
  flavor: Omit<ProductFlavor, 'id' | 'factory_id'>
): Promise<ProductFlavor> => {
  const factoryId = getFactoryId();
  const newFlavor: ProductFlavor = { ...flavor, id: generateId(), factory_id: factoryId };
  const flavors = await getFlavors();
  await setCache([newFlavor, ...flavors]);

  // Every sellable flavor gets its own finished-goods stock row, so a sale
  // of it has something real to deduct from (see store/sales.ts deduction).
  await ensureStockItem(newFlavor.id, newFlavor.label, 'sachet');

  const row = {
    id: newFlavor.id,
    factory_id: factoryId,
    label: newFlavor.label,
    weight_g: newFlavor.weightG,
    default_price: newFlavor.defaultPrice,
    recipe_per_unit: [],
  };
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new flavor from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('product_flavors').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'product_flavors', op: 'insert', values: row, label: 'saveur' });

  return newFlavor;
};

export const updateFlavor = async (
  id: string,
  updates: Partial<Omit<ProductFlavor, 'id' | 'factory_id'>>
): Promise<void> => {
  const flavors = await getFlavors();
  await setCache(flavors.map((f) => (f.id === id ? { ...f, ...updates } : f)));

  const row: Record<string, unknown> = {};
  if (updates.label !== undefined) row.label = updates.label;
  if (updates.weightG !== undefined) row.weight_g = updates.weightG;
  if (updates.defaultPrice !== undefined) row.default_price = updates.defaultPrice;
  if (updates.recipePerUnit !== undefined) row.recipe_per_unit = updates.recipePerUnit;

  const factoryId = getFactoryId();
  const { error } = await supabase.from('product_flavors').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'product_flavors', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'saveur (modif.)' });
};

export const deleteFlavor = async (id: string): Promise<void> => {
  const flavors = await getFlavors();
  await setCache(flavors.filter((f) => f.id !== id));
  const factoryId = getFactoryId();
  const { error } = await supabase.from('product_flavors').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'product_flavors', op: 'delete', match: { id, factory_id: factoryId }, label: 'saveur (suppr.)' });
};

export const setFlavors = async (flavors: ProductFlavor[]): Promise<void> => {
  await setCache(flavors);
};
