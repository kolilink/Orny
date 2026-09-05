import AsyncStorage from '@react-native-async-storage/async-storage';
import { Expense } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';

function cacheKey() { return `${getFactoryId()}_expenses`; }
function trashKey() { return `${getFactoryId()}_expenses_trash`; }

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const getExpenses = async (): Promise<Expense[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Expense[]) : [];
};

export const getDeletedExpenses = async (): Promise<Expense[]> => {
  const data = await AsyncStorage.getItem(trashKey());
  if (!data) return [];
  const all = JSON.parse(data) as Expense[];
  const now = Date.now();
  // Auto-purge items older than 30 days
  const still = all.filter(e => e.deletedAt && now - new Date(e.deletedAt).getTime() < THIRTY_DAYS_MS);
  if (still.length !== all.length) await AsyncStorage.setItem(trashKey(), JSON.stringify(still));
  return still;
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
  const row = {
    id: item.id,
    factory_id: factoryId,
    date: item.date,
    category: item.category,
    description: item.description,
    amount: item.amount,
    payment_method: item.paymentMethod,
    line_items: item.lineItems ?? null,
  };
  supabase.from('expenses').insert(row).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'expenses', op: 'insert', values: row, label: 'dépense' });
  });
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
  const factoryId = getFactoryId();
  supabase.from('expenses').update(row).eq('id', id).eq('factory_id', factoryId).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'expenses', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'dépense (modif.)' });
  });
};

// Soft delete: moves to trash, hard-deletes from Supabase
export const deleteExpense = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const all = await getExpenses();
  const target = all.find(e => e.id === id);
  if (target) {
    const trash = await getDeletedExpenses();
    await AsyncStorage.setItem(trashKey(), JSON.stringify([{ ...target, deletedAt: new Date().toISOString() }, ...trash]));
    await setCache(all.filter(e => e.id !== id));
  }
  supabase.from('expenses').delete().eq('id', id).eq('factory_id', factoryId).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'expenses', op: 'delete', match: { id, factory_id: factoryId }, label: 'dépense (suppr.)' });
  });
};

// Restore a soft-deleted expense
export const restoreExpense = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const trash = await getDeletedExpenses();
  const target = trash.find(e => e.id === id);
  if (!target) return;
  const { deletedAt: _d, ...restored } = target;
  const active = await getExpenses();
  await setCache([restored, ...active]);
  await AsyncStorage.setItem(trashKey(), JSON.stringify(trash.filter(e => e.id !== id)));
  const row = {
    id: restored.id,
    factory_id: factoryId,
    date: restored.date,
    category: restored.category,
    description: restored.description,
    amount: restored.amount,
    payment_method: restored.paymentMethod,
    line_items: restored.lineItems ?? null,
  };
  supabase.from('expenses').insert(row).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'expenses', op: 'insert', values: row, label: 'dépense (restaur.)' });
  });
};

// Permanently delete from trash
export const purgeDeletedExpense = async (id: string): Promise<void> => {
  const trash = await getDeletedExpenses();
  await AsyncStorage.setItem(trashKey(), JSON.stringify(trash.filter(e => e.id !== id)));
};
