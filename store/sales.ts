import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sale, EditHistoryEntry } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';

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
    costAmount: r.cost_amount,
  }));
  await setCache(sales);
};

// ─── CRUD (write-through: cache first, then Supabase) ────────

export const addSale = async (sale: Omit<Sale, 'id' | 'factory_id'>): Promise<Sale> => {
  const factoryId = getFactoryId();
  const newSale: Sale = { ...sale, id: generateId(), factory_id: factoryId };
  const sales = await getSales();
  await setCache([newSale, ...sales]);

  const row = {
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
    cost_amount: newSale.costAmount ?? null,
  };
  supabase.from('sales').insert(row).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'sales', op: 'insert', values: row, label: 'vente' });
  });

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
  const factoryId = getFactoryId();

  supabase.from('sales').update(row).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => {
      if (error) enqueueIfNetworkError(error, { table: 'sales', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'vente (modif.)' });
    });
};

export const deleteSale = async (id: string): Promise<void> => {
  const sales = await getSales();
  await setCache(sales.filter((s) => s.id !== id));
  const factoryId = getFactoryId();
  supabase.from('sales').delete().eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => {
      if (error) enqueueIfNetworkError(error, { table: 'sales', op: 'delete', match: { id, factory_id: factoryId }, label: 'vente (suppr.)' });
    });
};

export const setSales = async (sales: Sale[]): Promise<void> => {
  await setCache(sales);
};

// Append-only edit history, written automatically by a DB trigger on every
// UPDATE to this sale — see db/update15.sql. Always reads live (no local
// cache): this is meant to be trustworthy, not fast.
export const getSaleEditHistory = async (saleId: string): Promise<EditHistoryEntry<Partial<Sale>>[]> => {
  const { data, error } = await supabase
    .from('sale_edits')
    .select('*')
    .eq('sale_id', saleId)
    .order('edited_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    editedBy: r.edited_by ?? undefined,
    editedAt: r.edited_at,
    before: r.before,
    after: r.after,
  }));
};
