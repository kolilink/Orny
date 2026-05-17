import AsyncStorage from '@react-native-async-storage/async-storage';
import { Expense } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_expenses`; }

export const getExpenses = async (): Promise<Expense[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Expense[]) : [];
};

const setCache = async (items: Expense[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(items));
};

export const syncExpensesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('factory_id', factoryId)
    .order('date', { ascending: false });
  if (error || !data) return;
  const items: Expense[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    date: r.date,
    category: r.category,
    description: r.description,
    amount: r.amount,
    paymentMethod: r.payment_method,
    lineItems: r.line_items ?? undefined,
  }));
  await setCache(items);
};

export const addExpense = async (expense: Omit<Expense, 'id' | 'factory_id'>): Promise<Expense> => {
  const factoryId = getFactoryId();
  const item: Expense = { ...expense, id: generateId(), factory_id: factoryId };
  const all = await getExpenses();
  await setCache([item, ...all]);
  supabase.from('expenses').insert({
    id: item.id,
    factory_id: factoryId,
    date: item.date,
    category: item.category,
    description: item.description,
    amount: item.amount,
    payment_method: item.paymentMethod,
    line_items: item.lineItems ?? null,
  }).then();
  return item;
};

export const updateExpense = async (id: string, updates: Partial<Omit<Expense, 'id' | 'factory_id'>>): Promise<void> => {
  const all = await getExpenses();
  await setCache(all.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  const row: Record<string, unknown> = {};
  if (updates.date !== undefined) row.date = updates.date;
  if (updates.category !== undefined) row.category = updates.category;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.amount !== undefined) row.amount = updates.amount;
  if (updates.paymentMethod !== undefined) row.payment_method = updates.paymentMethod;
  if (updates.lineItems !== undefined) row.line_items = updates.lineItems ?? null;
  supabase.from('expenses').update(row).eq('id', id).eq('factory_id', getFactoryId()).then();
};

export const deleteExpense = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getExpenses();
  await setCache(all.filter((e) => e.id !== id));
  supabase.from('expenses').delete().eq('id', id).eq('factory_id', factoryId).then();
};
