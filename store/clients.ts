import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '../types';
import { FACTORY_CONFIG } from '../config/factory';

const KEY = `${FACTORY_CONFIG.id}_clients`;

export const getClients = async (): Promise<Client[]> => {
  const data = await AsyncStorage.getItem(KEY);
  return data ? (JSON.parse(data) as Client[]) : [];
};

export const getClientNames = async (): Promise<string[]> => {
  const clients = await getClients();
  return clients.map((c) => c.name);
};

export const upsertClient = async (
  name: string,
  location?: string,
  type?: string,
  phone?: string
): Promise<Client> => {
  const clients = await getClients();
  const existing = clients.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing;
  const newClient: Client = {
    id: Date.now().toString(),
    factory_id: FACTORY_CONFIG.id,
    name,
    location,
    type,
    phone,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([newClient, ...clients]));
  return newClient;
};

export const updateClient = async (
  id: string,
  updates: Partial<Omit<Client, 'id' | 'factory_id'>>
): Promise<void> => {
  const clients = await getClients();
  const updated = clients.map((c) => (c.id === id ? { ...c, ...updates } : c));
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
};

export const deleteClient = async (id: string): Promise<void> => {
  const clients = await getClients();
  await AsyncStorage.setItem(KEY, JSON.stringify(clients.filter((c) => c.id !== id)));
};

export const setClients = async (clients: Client[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(clients));
};
