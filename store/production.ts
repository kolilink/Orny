import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProductionBatch } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_production`;

export const getBatches = async (): Promise<ProductionBatch[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as ProductionBatch[]) : [];
};

export const addBatch = async (
  batch: Omit<ProductionBatch, 'id' | 'factory_id' | 'yieldGramsPerKg'>
): Promise<ProductionBatch> => {
  const batches = await getBatches();
  const yieldGramsPerKg =
    batch.potatoesUsedKg > 0
      ? (batch.sachets80g * 80) / batch.potatoesUsedKg
      : 0;
  const newBatch: ProductionBatch = {
    ...batch,
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
    yieldGramsPerKg,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newBatch, ...batches]));
  return newBatch;
};

export const setBatches = async (batches: ProductionBatch[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(batches));
};
