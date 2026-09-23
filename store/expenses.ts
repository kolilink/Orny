import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Expense } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { withTimeout } from '../lib/withTimeout';

function cacheKey() { return `${getFactoryId()}_expenses`; }
function trashKey() { return `${getFactoryId()}_expenses_trash`; }

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECEIPTS_BUCKET = 'expense-receipts';

// Signed URLs (bucket is private) so a receipt is viewable from any device,
// not just the one that originally uploaded it. Same pattern as
// store/documents.ts's getSignedDocumentUrl.
export const getSignedReceiptUrl = async (storagePath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
};

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
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('expenses').select('*').eq('factory_id', factoryId).order('date', { ascending: false })
    ));
  } catch {
    return;
  }
  if (error || !data) return;
  // photoUri is device-local (a file:// path from whichever device
  // uploaded it) — never overwritten from a server row, same posture as
  // store/documents.ts preserving fileUri across a sync.
  const existing = await getExpenses();
  const existingById = Object.fromEntries(existing.map((e) => [e.id, e]));
  const items: Expense[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    date: r.date,
    category: r.category,
    description: r.description,
    amount: r.amount,
    paymentMethod: r.payment_method,
    lineItems: r.line_items ?? undefined,
    photoUri: existingById[r.id]?.photoUri,
    photoStoragePath: r.photo_storage_path ?? undefined,
  }));
  await setCache(items);
};

export const addExpense = async (expense: Omit<Expense, 'id' | 'factory_id'>): Promise<Expense> => {
  const factoryId = getFactoryId();
  const id = generateId();
  let photoStoragePath: string | undefined;

  // Real upload — a device-local file:// path (expense.photoUri, freshly
  // picked from camera/gallery) means nothing on another device or after a
  // reinstall, so this is what makes the receipt actually recoverable and
  // visible to every other member of the factory. Mirrors
  // store/documents.ts's addDocument upload step. Web's picker resolves a
  // `data:` URL directly (see screens/Expenses's webPickFromDisk) — its
  // base64 is already embedded in the string, so it's decoded straight
  // from there instead of through FileSystem, which doesn't read data: URIs.
  if (expense.photoUri) {
    try {
      const base64 = expense.photoUri.startsWith('data:')
        ? expense.photoUri.split(',')[1]
        : await FileSystem.readAsStringAsync(expense.photoUri, { encoding: 'base64' });
      const path = `${factoryId}/${id}.jpg`;
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, decode(base64), {
        contentType: 'image/jpeg',
      });
      if (error) throw error;
      photoStoragePath = path;
    } catch (e) {
      console.warn('expense receipt upload error', e);
    }
  }

  const item: Expense = { ...expense, id, factory_id: factoryId, photoStoragePath };
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
    photo_storage_path: item.photoStoragePath ?? null,
  };
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new expense from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('expenses').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'expenses', op: 'insert', values: row, label: 'dépense' });
  return item;
};

export const updateExpense = async (id: string, updates: Partial<Omit<Expense, 'id' | 'factory_id'>>): Promise<void> => {
  const factoryId = getFactoryId();

  // A freshly-picked photoUri here is a new local file:// (or web data:)
  // URI to upload, replacing any existing receipt — same upload step as
  // addExpense, just reached from the edit path. Leaving photoUri out of
  // `updates` entirely (the normal case — most edits don't touch the
  // photo) leaves whatever receipt already exists untouched.
  let resolvedUpdates = updates;
  if (updates.photoUri) {
    try {
      const base64 = updates.photoUri.startsWith('data:')
        ? updates.photoUri.split(',')[1]
        : await FileSystem.readAsStringAsync(updates.photoUri, { encoding: 'base64' });
      const path = `${factoryId}/${id}.jpg`;
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, decode(base64), {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (error) throw error;
      resolvedUpdates = { ...updates, photoStoragePath: path };
    } catch (e) {
      console.warn('expense receipt upload error', e);
    }
  }

  const all = await getExpenses();
  await setCache(all.map((e) => (e.id === id ? { ...e, ...resolvedUpdates } : e)));
  const row: Record<string, unknown> = {};
  if (resolvedUpdates.date !== undefined) row.date = resolvedUpdates.date;
  if (resolvedUpdates.category !== undefined) row.category = resolvedUpdates.category;
  if (resolvedUpdates.description !== undefined) row.description = resolvedUpdates.description;
  if (resolvedUpdates.amount !== undefined) row.amount = resolvedUpdates.amount;
  if (resolvedUpdates.paymentMethod !== undefined) row.payment_method = resolvedUpdates.paymentMethod;
  if (resolvedUpdates.lineItems !== undefined) row.line_items = resolvedUpdates.lineItems ?? null;
  if (resolvedUpdates.photoStoragePath !== undefined) row.photo_storage_path = resolvedUpdates.photoStoragePath;
  const { error } = await supabase.from('expenses').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'expenses', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'dépense (modif.)' });
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
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'expenses', op: 'delete', match: { id, factory_id: factoryId }, label: 'dépense (suppr.)' });
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
  const { error } = await supabase.from('expenses').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'expenses', op: 'insert', values: row, label: 'dépense (restaur.)' });
};

// Permanently delete from trash
export const purgeDeletedExpense = async (id: string): Promise<void> => {
  const trash = await getDeletedExpenses();
  await AsyncStorage.setItem(trashKey(), JSON.stringify(trash.filter(e => e.id !== id)));
};
