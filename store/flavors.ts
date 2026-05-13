import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProductFlavor } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_flavors`;

export const getFlavors = async (): Promise<ProductFlavor[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as ProductFlavor[]) : [];
};

export const addFlavor = async (
  flavor: Omit<ProductFlavor, 'id' | 'factory_id'>
): Promise<ProductFlavor> => {
  const flavors = await getFlavors();
  const newFlavor: ProductFlavor = {
    ...flavor,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newFlavor, ...flavors]));
  return newFlavor;
};

export const updateFlavor = async (
  id: string,
  updates: Partial<Omit<ProductFlavor, 'id' | 'factory_id'>>
): Promise<void> => {
  const flavors = await getFlavors();
  const updated = flavors.map((f) => (f.id === id ? { ...f, ...updates } : f));
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};

export const deleteFlavor = async (id: string): Promise<void> => {
  const flavors = await getFlavors();
  await AsyncStorage.setItem(KEY, JSON.stringify(flavors.filter((f) => f.id !== id)));
};

export const setFlavors = async (flavors: ProductFlavor[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(flavors));
};
