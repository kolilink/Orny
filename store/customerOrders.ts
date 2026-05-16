import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

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
  const { data, error } = await supabase
    .from('customer_orders')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return;
  const items: CustomerOrder[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
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

export const addCustomerOrder = async (
  order: Omit<CustomerOrder, 'id' | 'factory_id' | 'createdAt'>,
): Promise<CustomerOrder> => {
  const factoryId = getFactoryId();
  const item: CustomerOrder = {
    ...order,
    id: generateId(),
    factory_id: factoryId,
    createdAt: new Date().toISOString(),
  };
  const all = await getCustomerOrders();
  await setCache([item, ...all]);
  supabase.from('customer_orders').insert({
    id: item.id,
    factory_id: factoryId,
    client_name: item.clientName,
    product: item.product,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_amount: item.totalAmount,
    delivery_date: item.deliveryDate,
    status: item.status,
    notes: item.notes ?? null,
    created_at: item.createdAt,
  }).then();
  return item;
};

export const updateCustomerOrderStatus = async (
  id: string,
  status: CustomerOrder['status'],
): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getCustomerOrders();
  const updated = all.map((o) => (o.id === id ? { ...o, status } : o));
  await setCache(updated);
  supabase.from('customer_orders').update({ status }).eq('id', id).eq('factory_id', factoryId).then();
};

export const deleteCustomerOrder = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getCustomerOrders();
  await setCache(all.filter((o) => o.id !== id));
  supabase.from('customer_orders').delete().eq('id', id).eq('factory_id', factoryId).then();
};
