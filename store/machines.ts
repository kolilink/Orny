import AsyncStorage from '@react-native-async-storage/async-storage';
import { Machine, MachineStatus } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';

function cacheKey() { return `${getFactoryId()}_machines`; }

export const getMachines = async (): Promise<Machine[]> => {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as Machine[]) : [];
};

const setCache = async (machines: Machine[]) => {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(machines));
};

export const syncMachinesFromSupabase = async (): Promise<void> => {
  const factoryId = getFactoryId();
  const { data, error } = await supabase
    .from('machines')
    .select('*')
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: true });
  if (error || !data) return;
  const machines: Machine[] = data.map((r) => ({
    id: r.id,
    factory_id: r.factory_id,
    name: r.name,
    type: r.type ?? '',
    ratedCapacity: r.rated_capacity,
    capacityUnit: r.capacity_unit,
    status: r.status as MachineStatus,
    commissionedDate: r.commissioned_date ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  }));
  await setCache(machines);
};

export const addMachine = async (
  machine: Omit<Machine, 'id' | 'factory_id' | 'createdAt'>
): Promise<Machine> => {
  const factoryId = getFactoryId();
  const now = new Date().toISOString();
  const newMachine: Machine = { ...machine, id: generateId(), factory_id: factoryId, createdAt: now };
  const machines = await getMachines();
  await setCache([...machines, newMachine]);

  supabase.from('machines').insert({
    id: newMachine.id,
    factory_id: factoryId,
    name: newMachine.name,
    type: newMachine.type,
    rated_capacity: newMachine.ratedCapacity,
    capacity_unit: newMachine.capacityUnit,
    status: newMachine.status,
    commissioned_date: newMachine.commissionedDate ?? null,
    notes: newMachine.notes ?? null,
    created_at: now,
  }).then(({ error }) => { if (error) console.warn('machine insert sync error', error.message); });

  return newMachine;
};

export const updateMachine = async (
  id: string,
  updates: Partial<Pick<Machine, 'name' | 'type' | 'ratedCapacity' | 'capacityUnit' | 'commissionedDate' | 'notes'>>
): Promise<void> => {
  const factoryId = getFactoryId();
  const machines = await getMachines();
  const updated = machines.map((m) => (m.id === id ? { ...m, ...updates } : m));
  await setCache(updated);

  supabase.from('machines').update({
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.type !== undefined ? { type: updates.type } : {}),
    ...(updates.ratedCapacity !== undefined ? { rated_capacity: updates.ratedCapacity } : {}),
    ...(updates.capacityUnit !== undefined ? { capacity_unit: updates.capacityUnit } : {}),
    ...(updates.commissionedDate !== undefined ? { commissioned_date: updates.commissionedDate } : {}),
    ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
  }).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('machine update sync error', error.message); });
};

// Updates the machine's current status AND appends to machine_status_log —
// the log is what lets a future uptime/downtime calculation work from real
// history instead of only ever seeing the latest status.
export const updateMachineStatus = async (
  id: string,
  status: MachineStatus,
  reason?: string
): Promise<void> => {
  const factoryId = getFactoryId();
  const machines = await getMachines();
  const updated = machines.map((m) => (m.id === id ? { ...m, status } : m));
  await setCache(updated);

  supabase.from('machines').update({ status }).eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('machine status update sync error', error.message); });

  supabase.from('machine_status_log').insert({
    id: generateId(),
    factory_id: factoryId,
    machine_id: id,
    status,
    reason: reason ?? null,
  }).then(({ error }) => { if (error) console.warn('machine status log sync error', error.message); });
};

export const deleteMachine = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const machines = await getMachines();
  await setCache(machines.filter((m) => m.id !== id));
  supabase.from('machines').delete().eq('id', id).eq('factory_id', factoryId)
    .then(({ error }) => { if (error) console.warn('machine delete sync error', error.message); });
};
