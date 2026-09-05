import AsyncStorage from '@react-native-async-storage/async-storage';
import { Purchase } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { recordStockAddition } from './stock';

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
    stockItemId: r.stock_item_id ?? undefined,
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: r.unit_price,
    totalAmount: r.total_amount,
    amountPaid: r.amount_paid ?? undefined,
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
  const row = {
    id: item.id,
    factory_id: factoryId,
    supplier_id: item.supplierId ?? null,
    supplier_name: item.supplierName,
    date: item.date,
    product: item.product,
    stock_item_id: item.stockItemId ?? null,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unitPrice,
    total_amount: item.totalAmount,
    amount_paid: item.amountPaid ?? null,
    payment_method: item.paymentMethod,
    notes: item.notes ?? null,
  };
  supabase.from('purchases').insert(row).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'purchases', op: 'insert', values: row, label: 'achat' });
  });

  // Buying raw material actually raises what's on hand — without this a
  // purchase only ever showed up as a cost, never as usable stock. It also
  // updates that item's weighted-average cost, so what gets consumed later
  // (a batch, a sale) carries a real GNF cost instead of nothing.
  if (item.stockItemId) {
    await recordStockAddition(item.stockItemId, item.quantity, item.unitPrice);
  }

  return item;
};

// Records a payment against an existing purchase's outstanding balance —
// the same "mark as paid" shape Ventes already uses for a client credit
// sale, applied to what's owed to a supplier instead.
export const recordPurchasePayment = async (id: string, newAmountPaid: number): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getPurchases();
  const updated = all.map((p) => (p.id === id ? { ...p, amountPaid: newAmountPaid } : p));
  await setCache(updated);
  supabase.from('purchases').update({ amount_paid: newAmountPaid }).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => {
      if (error) enqueueIfNetworkError(error, { table: 'purchases', op: 'update', values: { amount_paid: newAmountPaid }, match: { id, factory_id: factoryId }, label: 'achat (paiement)' });
    });
};

export const deletePurchase = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getPurchases();
  await setCache(all.filter((p) => p.id !== id));
  supabase.from('purchases').delete().eq('id', id).eq('factory_id', factoryId).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'purchases', op: 'delete', match: { id, factory_id: factoryId }, label: 'achat (suppr.)' });
  });
};
