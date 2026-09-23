import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';

function cacheKey() { return `${getFactoryId()}_customer_orders`; }

export const getCustomerOrders = async (): Promise<CustomerOrder[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as CustomerOrder[]) : [];
};

const setCache = async (items: CustomerOrder[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(items));
};

export const syncCustomerOrdersFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('customer_orders').select('*').eq('factory_id', factoryId).order('created_at', { ascending: false })
    ));
  } catch {
    return;
  }
  if (error || !data) return;
  const items: CustomerOrder[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    orderGroupId: r.order_group_id,
    clientName: r.client_name,
    product: r.product,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    totalAmount: r.total_amount,
    deliveryDate: r.delivery_date,
    status: r.status,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  }));
  await setCache(items);
};

type OrderLineInput = { product: string; quantity: number; unitPrice: number };

// A client's phone-in order is almost never exactly one product — this
// creates every line of one order in a single call, all sharing one fresh
// orderGroupId (see db/update26.sql), so the screen can later group/
// status-change/delete them together as the one real order they are.
export const addCustomerOrderGroup = async (
  clientName: string,
  lines: OrderLineInput[],
  deliveryDate: string,
  notes: string | undefined,
): Promise<CustomerOrder[]> => {
  const factoryId = getFactoryId();
  const groupId = generateId();
  const createdAt = new Date().toISOString();
  const items: CustomerOrder[] = lines.map((line) => ({
    id: generateId(),
    factory_id: factoryId,
    orderGroupId: groupId,
    clientName,
    product: line.product,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    totalAmount: line.quantity * line.unitPrice,
    deliveryDate,
    status: 'pending',
    notes,
    createdAt,
  }));

  const all = await getCustomerOrders();
  await setCache([...items, ...all]);

  const rows = items.map((item) => ({
    id: item.id,
    factory_id: factoryId,
    order_group_id: item.orderGroupId,
    client_name: item.clientName,
    product: item.product,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_amount: item.totalAmount,
    delivery_date: item.deliveryDate,
    status: item.status,
    notes: item.notes ?? null,
    created_at: item.createdAt,
  }));
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new order from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('customer_orders').insert(rows);
  if (error) await enqueueIfNetworkError(error, { table: 'customer_orders', op: 'insert', values: rows, label: 'commande client' });
  return items;
};

export const updateCustomerOrderGroupStatus = async (
  groupId: string,
  status: CustomerOrder['status'],
): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getCustomerOrders();
  const updated = all.map((o) => (o.orderGroupId === groupId ? { ...o, status } : o));
  await setCache(updated);
  const { error } = await supabase.from('customer_orders').update({ status }).eq('order_group_id', groupId).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'customer_orders', op: 'update', values: { status }, match: { order_group_id: groupId, factory_id: factoryId }, label: 'commande client (modif.)' });
};

export const deleteCustomerOrderGroup = async (groupId: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getCustomerOrders();
  await setCache(all.filter((o) => o.orderGroupId !== groupId));
  const { error } = await supabase.from('customer_orders').delete().eq('order_group_id', groupId).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'customer_orders', op: 'delete', match: { order_group_id: groupId, factory_id: factoryId }, label: 'commande client (suppr.)' });
};
