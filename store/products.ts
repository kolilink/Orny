import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
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
  const product: Product = { id, factory_id: factoryId, name, unit, lastRecipe: [], createdAt: now };
  const products = await getProducts();
  await setCache([...products, product]);

  // Create a stock item for this product's finished-goods tracking (id = product.id)
  await addStockItem({ id, name, unit, currentLevel: 0, alertThreshold: 0 });

  supabase.from('production_products').insert({
    id, factory_id: factoryId, name, unit, last_recipe: [], created_at: now,
  }).then(({ error }) => { if (error) console.warn('product insert sync error', error.message); });

  return product;
};

export const updateProduct = async (
  id: string,
  updates: Partial<Pick<Product, 'name' | 'unit' | 'lastRecipe'>>
): Promise<void> => {
  const factoryId = getFactoryId();
  const products = await getProducts();
  const updated = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
  await setCache(updated);

  supabase.from('production_products').update({
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit } : {}),
    ...(updates.lastRecipe !== undefined ? { last_recipe: updates.lastRecipe } : {}),
  }).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('product update sync error', error.message); });
};

export const deleteProduct = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const products = await getProducts();
  await setCache(products.filter((p) => p.id !== id));
  supabase.from('production_products').delete().eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('product delete sync error', error.message); });
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
    lastRecipe: r.last_recipe ?? [],
    createdAt: r.created_at,
  }));
  await setCache(products);
};
