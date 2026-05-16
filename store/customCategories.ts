import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomCategory } from '../types';
import { getFactoryId, generateId } from './context';

function cacheKey() { return `${getFactoryId()}_custom_categories`; }

export const getCustomCategories = async (): Promise<CustomCategory[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as CustomCategory[]) : [];
};

export const addCustomCategory = async (label: string, icon: string): Promise<CustomCategory> => {
  const cat: CustomCategory = { key: generateId(), label: label.trim(), icon: icon.trim() || '📦' };
  const all = await getCustomCategories();
  await AsyncStorage.setItem(cacheKey(), JSON.stringify([...all, cat]));
  return cat;
};

export const deleteCustomCategory = async (key: string): Promise<void> => {
  const all = await getCustomCategories();
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(all.filter((c) => c.key !== key)));
};
