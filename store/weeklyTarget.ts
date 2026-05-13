import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFactoryId } from './context';
import { FACTORY_CONFIG } from '../config/factory';

function cacheKey() { return `${getFactoryId()}_weekly_target`; }

export const getWeeklyTarget = async (): Promise<number> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? parseInt(data, 10) : FACTORY_CONFIG.weeklyProductionTarget;
};

export const setWeeklyTarget = async (target: number): Promise<void> => {
  await AsyncStorage.setItem(cacheKey(), String(target));
};
