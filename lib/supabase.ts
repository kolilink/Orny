import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — check your .env file');
}

// iOS SecureStore limit is 2 048 bytes per key; chunk large values (e.g. full session JSON).
const CHUNK = 2048;

async function secureGet(key: string): Promise<string | null> {
  const nStr = await SecureStore.getItemAsync(`${key}__n`);
  if (nStr === null) return SecureStore.getItemAsync(key);
  const n = parseInt(nStr, 10);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(`${key}__${i}`);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function secureSet(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const n = Math.ceil(value.length / CHUNK);
  await SecureStore.setItemAsync(`${key}__n`, String(n));
  for (let i = 0; i < n; i++) {
    await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
}

async function secureDel(key: string): Promise<void> {
  const nStr = await SecureStore.getItemAsync(`${key}__n`);
  if (nStr !== null) {
    const n = parseInt(nStr, 10);
    await SecureStore.deleteItemAsync(`${key}__n`);
    for (let i = 0; i < n; i++) {
      await SecureStore.deleteItemAsync(`${key}__${i}`);
    }
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

const SecureStoreAdapter = {
  getItem: secureGet,
  setItem: secureSet,
  removeItem: secureDel,
};

const webStorageAdapter = {
  getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
  setItem: (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve(); },
  removeItem: (key: string) => { localStorage.removeItem(key); return Promise.resolve(); },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? webStorageAdapter : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
