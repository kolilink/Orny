import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sale } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_sales`; }

// ─── LOCAL CACHE (instant reads) ─────────────────────────────

export const getSales = async (): Promise<Sale[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Sale[]) : [];
};

const setCache = async (sales: Sale[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(sales));
};

// ─── SUPABASE SYNC (background) ──────────────────────────────

export const syncSalesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  const sales: Sale[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    date: r.date,
    clientName: r.client_name,
    product: r.product,
    productType: r.product_type,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    totalAmount: r.total_amount,
    amountPaid: r.amount_paid,
    paymentMethod: r.payment_method,
  }));
  await setCache(sales);
};

// ─── CRUD (write-through: cache first, then Supabase) ────────

export const addSale = async (sale: Omit<Sale, 'id' | 'factory_id'>): Promise<Sale> => {
  const factoryId = getFactoryId();
  const newSale: Sale = { ...sale, id: generateId(), factory_id: factoryId };
  const sales = await getSales();
  await setCache([newSale, ...sales]);

  supabase.from('sales').insert({
    id: newSale.id,
    factory_id: factoryId,
    date: newSale.date,
    client_name: newSale.clientName,
    product: newSale.product,
    product_type: newSale.productType,
    quantity: newSale.quantity,
    unit_price: newSale.unitPrice,
    total_amount: newSale.totalAmount,
    amount_paid: newSale.amountPaid,
    payment_method: newSale.paymentMethod,
  }).then(({ error }) => { if (error) console.warn('sales insert sync error', error.message); });

  return newSale;
};

export const updateSale = async (id: string, updates: Partial<Omit<Sale, 'id' | 'factory_id'>>): Promise<void> => {
  const sales = await getSales();
  await setCache(sales.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const row: Record<string, unknown> = {};
  if (updates.date !== undefined) row.date = updates.date;
  if (updates.clientName !== undefined) row.client_name = updates.clientName;
  if (updates.product !== undefined) row.product = updates.product;
  if (updates.productType !== undefined) row.product_type = updates.productType;
  if (updates.quantity !== undefined) row.quantity = updates.quantity;
  if (updates.unitPrice !== undefined) row.unit_price = updates.unitPrice;
  if (updates.totalAmount !== undefined) row.total_amount = updates.totalAmount;
  if (updates.amountPaid !== undefined) row.amount_paid = updates.amountPaid;
  if (updates.paymentMethod !== undefined) row.payment_method = updates.paymentMethod;
  row.updated_at = new Date().toISOString();

  supabase.from('sales').update(row).eq('id', id)
    .then(({ error }) => { if (error) console.warn('sales update sync error', error.message); });
};

export const deleteSale = async (id: string): Promise<void> => {
  const sales = await getSales();
  await setCache(sales.filter((s) => s.id !== id));
  supabase.from('sales').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('sales delete sync error', error.message); });
};

export const setSales = async (sales: Sale[]): Promise<void> => {
  await setCache(sales);
};
