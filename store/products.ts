import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';
import { addStockItem } from './stock';

function cacheKey() { return `${getFactoryId()}_products_v2`; }

export const getProducts = async (): Promise<Product[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Product[]) : [];
};

const setCache = async (products: Product[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(products));
};

export const addProduct = async (name: string, unit: string): Promise<Product> => {
  const factoryId = getFactoryId();
  const id = generateId();
  const now = new Date().toISOString();
  const product: Product = { id, factory_id: factoryId, name, unit, recipePerUnit: [], createdAt: now };
  const products = await getProducts();
  await setCache([...products, product]);

  // Create a stock item for this product's finished-goods tracking (id = product.id)
  await addStockItem({ id, name, unit, currentLevel: 0, alertThreshold: 0 });

  const row = { id, factory_id: factoryId, name, unit, recipe_per_unit: [], created_at: now };
  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new product from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const { error } = await supabase.from('production_products').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'production_products', op: 'insert', values: row, label: 'produit' });

  return product;
};

export const updateProduct = async (
  id: string,
  updates: Partial<Pick<Product, 'name' | 'unit' | 'recipePerUnit'>>
): Promise<void> => {
  const factoryId = getFactoryId();
  const products = await getProducts();
  const updated = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
  await setCache(updated);

  const row = {
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit } : {}),
    ...(updates.recipePerUnit !== undefined ? { recipe_per_unit: updates.recipePerUnit } : {}),
  };
  const { error } = await supabase.from('production_products').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'production_products', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'produit (modif.)' });
};

export const deleteProduct = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const products = await getProducts();
  await setCache(products.filter((p) => p.id !== id));
  const { error } = await supabase.from('production_products').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'production_products', op: 'delete', match: { id, factory_id: factoryId }, label: 'produit (suppr.)' });
};

export const syncProductsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('production_products')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: true });
  if (error || !data) return;
  const products: Product[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    unit: r.unit,
    recipePerUnit: r.recipe_per_unit ?? [],
    createdAt: r.created_at,
  }));
  await setCache(products);
};
