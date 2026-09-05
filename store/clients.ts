import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { enqueueIfNetworkError } from '../lib/syncQueue';

function cacheKey() { return `${getFactoryId()}_clients`; }

export const getClients = async (): Promise<Client[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Client[]) : [];
};

export const getClientNames = async (): Promise<string[]> => {
  const clients = await getClients();
  return clients.map((c) => c.name);
};

const setCache = async (clients: Client[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(clients));
};

export const syncClientsFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('factory_id', factoryId);
  if (error || !data) return;
  const clients: Client[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    phone: r.phone,
    location: r.location,
    type: r.type,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
  await setCache(clients);
};

export const upsertClient = async (
  name: string,
  location?: string,
  type?: string,
  phone?: string
): Promise<Client> => {
  const factoryId = getFactoryId();
  const clients = await getClients();
  const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;

  const newClient: Client = { id: generateId(), factory_id: factoryId, name, location, type, phone };
  await setCache([newClient, ...clients]);

  const row = {
    id: newClient.id,
    factory_id: factoryId,
    name,
    phone: phone ?? null,
    location: location ?? null,
    type: type ?? null,
  };
  supabase.from('clients').insert(row).then(({ error }) => {
    if (error) enqueueIfNetworkError(error, { table: 'clients', op: 'insert', values: row, label: 'client' });
  });

  return newClient;
};

export const updateClient = async (
  id: string,
  updates: Partial<Omit<Client, 'id' | 'factory_id'>>
): Promise<void> => {
  const clients = await getClients();
  await setCache(clients.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  const factoryId = getFactoryId();
  supabase.from('clients').update(updates).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => {
      if (error) enqueueIfNetworkError(error, { table: 'clients', op: 'update', values: updates as Record<string, unknown>, match: { id, factory_id: factoryId }, label: 'client (modif.)' });
    });
};

export const deleteClient = async (id: string): Promise<void> => {
  const clients = await getClients();
  await setCache(clients.filter((c) => c.id !== id));
  const factoryId = getFactoryId();
  supabase.from('clients').delete().eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => {
      if (error) enqueueIfNetworkError(error, { table: 'clients', op: 'delete', match: { id, factory_id: factoryId }, label: 'client (suppr.)' });
    });
};

export const setClients = async (clients: Client[]): Promise<void> => {
  await setCache(clients);
};
