import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProductFlavor } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

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
  const { data, error } = await supabase
    .from('product_flavors')
    .select('*')
    .eq('factory_id', factoryId);
  if (error || !data) return;
  const flavors: ProductFlavor[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    label: r.label,
    weightG: r.weight_g,
    defaultPrice: r.default_price,
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

  supabase.from('product_flavors').insert({
    id: newFlavor.id,
    factory_id: factoryId,
    label: newFlavor.label,
    weight_g: newFlavor.weightG,
    default_price: newFlavor.defaultPrice,
  }).then(({ error }) => { if (error) console.warn('flavors insert sync error', error.message); });

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

  supabase.from('product_flavors').update(row).eq('id', id)
    .then(({ error }) => { if (error) console.warn('flavors update sync error', error.message); });
};

export const deleteFlavor = async (id: string): Promise<void> => {
  const flavors = await getFlavors();
  await setCache(flavors.filter((f) => f.id !== id));
  supabase.from('product_flavors').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('flavors delete sync error', error.message); });
};

export const setFlavors = async (flavors: ProductFlavor[]): Promise<void> => {
  await setCache(flavors);
};
