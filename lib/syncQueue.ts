import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { generateId } from '../store/context';
import { withTimeout } from './withTimeout';

const QUEUE_KEY = 'sync_queue_v1';
// A write that keeps failing for a NON-network reason (RLS, validation,
// bad data) must never just vanish after N tries — that is a factory
// sale or stock move disappearing with only a console warning nobody
// sees on a phone. Exhausted items move here, visibly, instead of being
// dropped. Nothing in the app reads this list yet except getDeadCount();
// surfacing it in the UI is the next step, not a reason to keep dropping.
const DEAD_QUEUE_KEY = 'sync_queue_dead_v1';
const MAX_ATTEMPTS = 5;

export type QueueOp = 'insert' | 'update' | 'delete' | 'upsert';

export interface QueueItem {
  id: string;
  table: string;
  op: QueueOp;
  values?: Record<string, unknown> | Record<string, unknown>[];
  match?: Record<string, unknown>;
  attempts: number;
  createdAt: number;
  label: string; // human-readable — shown nowhere yet, useful for debugging
}

// Every store here writes to Supabase fire-and-forget: cache first, then a
// `.then(({error}) => ...)` that used to just console.warn and move on. If
// that call failed because the device was offline, the write was silently
// lost forever — this device's cache said "saved," but nothing else (another
// device, another investor checking Reports remotely) would ever see it,
// with no error surfaced to anyone. This queue is what those `.then()`
// callbacks call instead, so a network failure gets retried once the app is
// back online rather than just vanishing.
export function isNetworkError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? '');
  return /network request failed|failed to fetch|fetch failed|network error|timeout/i.test(msg);
}

async function getQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueueItem[]) : [];
}

async function setQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  listeners.forEach((cb) => cb(items.length));
}

export async function getPendingCount(): Promise<number> {
  return (await getQueue()).length;
}

export async function getDeadCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(DEAD_QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueueItem[]).length : 0;
}

async function appendDead(items: QueueItem[]): Promise<void> {
  if (items.length === 0) return;
  const raw = await AsyncStorage.getItem(DEAD_QUEUE_KEY);
  const dead = raw ? (JSON.parse(raw) as QueueItem[]) : [];
  await AsyncStorage.setItem(DEAD_QUEUE_KEY, JSON.stringify([...dead, ...items]));
}

const listeners = new Set<(count: number) => void>();
export function onQueueChange(cb: (count: number) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Called from a store's write when the live Supabase call fails. Only a
// network-shaped failure gets queued for retry — a real rejection (bad data,
// an RLS/permission error) would never succeed no matter how many times it's
// retried, and silently swallowing that would hide an actual bug.
//
// That second half of the contract was never actually implemented — this
// used to just console.warn and return for a real error, exactly the
// "silently swallowing" it explicitly warns against. In a production
// TestFlight build nobody has a console attached to see that warning, so a
// genuine RLS/permission/validation rejection was completely invisible: the
// screen's own optimistic write already put the record in the local cache,
// this function ate the real error, and the caller's `await` just resolved
// normally — the UI proceeded exactly as if the save had actually reached
// Postgres. Found live: "Ajouter" on a new investor appeared to do nothing,
// and a direct `supabase db query --linked` confirmed no row had actually
// been created — the insert was failing for a real reason, not a network
// blip, and nothing anywhere surfaced that.
//
// Now re-throws the original error for a genuine (non-network) failure, so
// a caller with its own try/catch can show the user what actually happened
// instead of silently pretending success. Every one of this function's
// current call sites already runs at the top level of a plain async
// function (never inside a background retry loop), so throwing here only
// ever propagates to whichever screen action just triggered the write.
export async function enqueueIfNetworkError(
  error: unknown,
  item: Omit<QueueItem, 'id' | 'attempts' | 'createdAt'>
): Promise<void> {
  if (!isNetworkError(error)) {
    console.warn(`${item.label} sync error`, (error as any)?.message ?? error);
    throw error;
  }
  const queue = await getQueue();
  // Not crypto.randomUUID() — see store/context.ts's generateId(), reused
  // here rather than duplicating the same Hermes-safe fallback a second time.
  queue.push({ ...item, id: generateId(), attempts: 0, createdAt: Date.now() });
  await setQueue(queue);
}

async function runItem(item: QueueItem): Promise<{ error: any }> {
  let query: any = supabase.from(item.table);
  if (item.op === 'insert') return await query.insert(item.values);
  if (item.op === 'upsert') return await query.upsert(item.values);
  query = item.op === 'update' ? query.update(item.values) : query.delete();
  for (const [k, v] of Object.entries(item.match ?? {})) {
    query = query.eq(k, v);
  }
  return await query;
}

let draining = false;

// Drains in order. The moment a network error recurs, everything from that
// point on is left in the queue untouched for next time — there's no point
// burning through the rest one-by-one against a connection that's still down.
//
// Two hardening changes vs. the previous version:
// 1. Each item is bounded by withTimeout (12s): a dead/captive wifi that
//    hangs instead of rejecting can no longer stall the whole drain —
//    the timeout reads as a network error, so the rest stays queued.
// 2. A non-network failure that exhausts its attempts moves to the dead
//    list instead of being dropped with a console warning. A factory
//    write must never silently disappear.
export async function drainSyncQueue(): Promise<{ synced: number; pending: number }> {
  if (draining) return { synced: 0, pending: await getPendingCount() };
  draining = true;
  try {
    const queue = await getQueue();
    let synced = 0;
    const remaining: QueueItem[] = [];
    const dead: QueueItem[] = [];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      let error: any;
      try {
        ({ error } = await withTimeout(runItem(item), 12000));
      } catch (e) {
        error = e;
      }
      if (!error) { synced++; continue; }
      if (isNetworkError(error)) {
        remaining.push(...queue.slice(i));
        break;
      }
      const attempts = item.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        remaining.push({ ...item, attempts });
      } else {
        dead.push({ ...item, attempts });
      }
    }
    await appendDead(dead);
    await setQueue(remaining);
    return { synced, pending: remaining.length };
  } finally {
    draining = false;
  }
}

// Call this (without awaiting it) after any Supabase write SUCCEEDS.
// A success proves the device is online right now — that is the cheapest
// reliable "reconnect" signal we have without adding a NetInfo dependency,
// and it flushes older queued writes that may be waiting from an earlier
// offline stretch. drainSyncQueue's own `draining` guard makes concurrent
// calls safe; a failed drain is harmless because the queue is untouched.
export function drainAfterSuccessfulWrite(): void {
  drainSyncQueue().catch(() => {});
}
