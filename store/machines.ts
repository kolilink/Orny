import AsyncStorage from '@react-native-async-storage/async-storage';
import { Machine, MachineStatus } from '../types';
import { getFactoryId, generateId } from './context';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';
import { drainAfterSuccessfulWrite, enqueueIfNetworkError } from '../lib/syncQueue';

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
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.from('machines').select('*').eq('factory_id', factoryId).order('created_at', { ascending: true })
    ));
  } catch {
    return;
  }
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

  // Awaited — a fire-and-forget insert here races a caller's immediate
  // post-add reload/re-sync and can lose the new machine from view even
  // though it lands fine in Postgres (same bug reproduced and fixed for
  // store/investors.ts's addInvestor).
  const row = {
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
  };
  const { error } = await supabase.from('machines').insert(row);
  if (error) await enqueueIfNetworkError(error, { table: 'machines', op: 'insert', values: row, label: 'machine' });
  else drainAfterSuccessfulWrite();

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

  const row = {
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.type !== undefined ? { type: updates.type } : {}),
    ...(updates.ratedCapacity !== undefined ? { rated_capacity: updates.ratedCapacity } : {}),
    ...(updates.capacityUnit !== undefined ? { capacity_unit: updates.capacityUnit } : {}),
    ...(updates.commissionedDate !== undefined ? { commissioned_date: updates.commissionedDate } : {}),
    ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
  };
  const { error } = await supabase.from('machines').update(row).eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'machines', op: 'update', values: row, match: { id, factory_id: factoryId }, label: 'machine (modif.)' });
  else drainAfterSuccessfulWrite();
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

  const { error: statusError } = await supabase.from('machines').update({ status }).eq('id', id).eq('factory_id', factoryId);
  if (statusError) await enqueueIfNetworkError(statusError, { table: 'machines', op: 'update', values: { status }, match: { id, factory_id: factoryId }, label: 'machine (statut)' });
  else drainAfterSuccessfulWrite();

  const logRow = {
    id: generateId(),
    factory_id: factoryId,
    machine_id: id,
    status,
    reason: reason ?? null,
  };
  const { error: logError } = await supabase.from('machine_status_log').insert(logRow);
  if (logError) await enqueueIfNetworkError(logError, { table: 'machine_status_log', op: 'insert', values: logRow, label: 'machine (journal)' });
  else drainAfterSuccessfulWrite();
};

export const deleteMachine = async (id: string): Promise<void> => {
  const factoryId = getFactoryId();
  const machines = await getMachines();
  await setCache(machines.filter((m) => m.id !== id));
  const { error } = await supabase.from('machines').delete().eq('id', id).eq('factory_id', factoryId);
  if (error) await enqueueIfNetworkError(error, { table: 'machines', op: 'delete', match: { id, factory_id: factoryId }, label: 'machine (suppr.)' });
  else drainAfterSuccessfulWrite();
};
