import AsyncStorage from '@react-native-async-storage/async-storage';
import { Purchase } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_purchases`; }

export const getPurchases = async (): Promise<Purchase[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Purchase[]) : [];
};

const setCache = async (items: Purchase[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(items));
};

export const syncPurchasesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('factory_id', factoryId)
    .order('date', { ascending: false });
  if (error || !data) return;
  const items: Purchase[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    supplierId: r.supplier_id ?? undefined,
    supplierName: r.supplier_name,
    date: r.date,
    product: r.product,
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: r.unit_price,
    totalAmount: r.total_amount,
    paymentMethod: r.payment_method,
    notes: r.notes ?? undefined,
  }));
  await setCache(items);
};

export const addPurchase = async (purchase: Omit<Purchase, 'id' | 'factory_id'>): Promise<Purchase> => {
  const factoryId = getFactoryId();
  const item: Purchase = { ...purchase, id: generateId(), factory_id: factoryId };
  const all = await getPurchases();
  await setCache([item, ...all]);
  supabase.from('purchases').insert({
    id: item.id,
    factory_id: factoryId,
    supplier_id: item.supplierId ?? null,
    supplier_name: item.supplierName,
    date: item.date,
    product: item.product,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unitPrice,
    total_amount: item.totalAmount,
    payment_method: item.paymentMethod,
    notes: item.notes ?? null,
  }).then();
  return item;
};

export const deletePurchase = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getPurchases();
  await setCache(all.filter((p) => p.id !== id));
  supabase.from('purchases').delete().eq('id', id).eq('factory_id', factoryId).then();
};
