import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFactoryId, generateId } from '../store/context';

export type NotificationKind = 'stock' | 'predictive_stock' | 'orders' | 'ai';

export interface LoggedNotification {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  createdAt: string;
}

const MAX_ENTRIES = 50;

function cacheKey() {
  return `${getFactoryId()}_notification_log`;
}

// Local, on-device history of alerts this app has raised — today an alert
// disappears the moment it's dismissed from the OS tray, with no in-app
// record at all. This is deliberately local-only (not synced to Supabase);
// it's a convenience list, not an audit trail.
export async function getNotificationLog(): Promise<LoggedNotification[]> {
  const data = await AsyncStorage.getItem(cacheKey());
  return data ? (JSON.parse(data) as LoggedNotification[]) : [];
}

export async function logNotification(entry: Omit<LoggedNotification, 'id' | 'createdAt'>): Promise<void> {
  const log = await getNotificationLog();
  const next: LoggedNotification[] = [
    { ...entry, id: generateId(), createdAt: new Date().toISOString() },
    ...log,
  ].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(cacheKey(), JSON.stringify(next));
}

export async function clearNotificationLog(): Promise<void> {
  await AsyncStorage.setItem(cacheKey(), JSON.stringify([]));
}
