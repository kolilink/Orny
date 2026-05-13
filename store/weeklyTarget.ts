import AsyncStorage from '@react-native-async-storage/async-storage';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_weekly_target`;

export const getWeeklyTarget = async (): Promise<number> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? parseInt(data, 10) : FACTORY_CONFIG.weeklyProductionTarget;
};

export const setWeeklyTarget = async (target: number): Promise<void> => {
  await AsyncStorage.setItem(KEY, String(target));
};
