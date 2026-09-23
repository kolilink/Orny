import AsyncStorage from '@react-native-async-storage/async-storage';
import { Supplier } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';

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
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('suppliers').select('*').eq('factory_id', factoryId).order('name', { ascending: true })
    ));
  } catch {
    return;
  }
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
  const row = {
    id: item.id,
    factory_id: factoryId,
    name: item.name,
    phone: item.phone ?? null,
    product: item.product,
    notes: item.notes ?? null,
  };
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new supplier from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('suppliers').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'suppliers', op: 'insert', values: row, label: 'fournisseur' });
  return item;
};

export const updateSupplier = async (id: string, updates: Partial<Omit<Supplier, 'id' | 'factory_id'>>): Promise<void> => {
  const all = await getSuppliers();
  await setCache(all.map(s => s.id === id ? { ...s, ...updates } : s));
  const row: Record<string, unknown> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.phone !== undefined) row.phone = updates.phone ?? null;
  if (updates.product !== undefined) row.product = updates.product;
  if (updates.notes !== undefined) row.notes = updates.notes ?? null;
  const factoryId = getFactoryId();
  const { error } = await supabase.from('suppliers').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'suppliers', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'fournisseur (modif.)' });
};

export const deleteSupplier = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getSuppliers();
  await setCache(all.filter((s) => s.id !== id));
  const { error } = await supabase.from('suppliers').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'suppliers', op: 'delete', match: { id, factory_id: factoryId }, label: 'fournisseur (suppr.)' });
};
