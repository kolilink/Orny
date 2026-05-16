import AsyncStorage from '@react-native-async-storage/async-storage';
import { Supplier } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_suppliers`; }

export const getSuppliers = async (): Promise<Supplier[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Supplier[]) : [];
};

const setCache = async (items: Supplier[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(items));
};

export const syncSuppliersFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('factory_id', factoryId)
    .order('name', { ascending: true });
  if (error || !data) return;
  const items: Supplier[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    phone: r.phone ?? undefined,
    product: r.product,
    notes: r.notes ?? undefined,
  }));
  await setCache(items);
};

export const addSupplier = async (supplier: Omit<Supplier, 'id' | 'factory_id'>): Promise<Supplier> => {
  const factoryId = getFactoryId();
  const item: Supplier = { ...supplier, id: generateId(), factory_id: factoryId };
  const all = await getSuppliers();
  await setCache([...all, item]);
  supabase.from('suppliers').insert({
    id: item.id,
    factory_id: factoryId,
    name: item.name,
    phone: item.phone ?? null,
    product: item.product,
    notes: item.notes ?? null,
  }).then();
  return item;
};

export const deleteSupplier = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getSuppliers();
  await setCache(all.filter((s) => s.id !== id));
  supabase.from('suppliers').delete().eq('id', id).eq('factory_id', factoryId).then();
};
