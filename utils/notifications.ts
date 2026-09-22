import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Batch, CustomerOrder, Sale, StockItem } from '../types';
import { computeRunrates, projectedStockouts } from './runrate';
import { logNotification } from './notificationLog';
import { getStock } from '../store/stock';
import { getBatches } from '../store/batches';
import { getSales } from '../store/sales';
import { getCustomerOrders } from '../store/customerOrders';
import { stockSeverity } from './stockAlerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between repeat alerts

// Android locks a channel's sound in at creation time — changing it later
// has no effect on devices that already created the channel, so this is
// deliberately a NEW id rather than reusing whatever expo-notifications'
// own implicit default channel was called. iOS has no channel concept;
// content.sound below is what actually selects the sound there.
const ORNY_CHANNEL_ID = 'orny-default';
let channelReady = false;

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(ORNY_CHANNEL_ID, {
    name: 'Orny',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'notification.wav',
    vibrationPattern: [0, 200, 100, 200],
  });
  channelReady = true;
}

async function canNotify(key: string): Promise<boolean> {
  const last = await AsyncStorage.getItem(key);
  if (!last) return true;
  return Date.now() - parseInt(last, 10) > COOLDOWN_MS;
}

async function markNotified(key: string): Promise<void> {
  await AsyncStorage.setItem(key, String(Date.now()));
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const { status: asked } = await Notifications.requestPermissionsAsync();
    if (asked !== 'granted') return false;
  }
  await ensureNotificationChannel();
  return true;
}

export async function checkStockAlerts(items: StockItem[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const critical = items.filter((i) => stockSeverity(i.currentLevel, i.alertThreshold) === 'critical');
  const low = items.filter((i) => stockSeverity(i.currentLevel, i.alertThreshold) === 'low');
  if (critical.length === 0 && low.length === 0) return;
  if (!(await canNotify('notif_stock'))) return;
  if (!(await requestNotificationPermission())) return;

  if (critical.length > 0) {
    const title = '🚨 Stock épuisé';
    const body = critical.map((i) => i.name).join(', ');
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'notification.wav' },
      trigger: { channelId: ORNY_CHANNEL_ID },
    });
    logNotification({ title, body, kind: 'stock' }).catch(() => {});
  }
  if (low.length > 0) {
    const title = '⚠️ Stock bas';
    const body = low.map((i) => `${i.name} : ${i.currentLevel} ${i.unit}`).join(', ');
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'notification.wav' },
      trigger: { channelId: ORNY_CHANNEL_ID },
    });
    logNotification({ title, body, kind: 'stock' }).catch(() => {});
  }
  await markNotified('notif_stock');
}

// Predictive counterpart to checkStockAlerts above: warns before an item
// actually crosses its alert threshold, if it's being consumed fast enough
// that it will run out within `withinDays` regardless. Uses the same
// trailing-consumption runrate as Claude's data block (utils/runrate.ts),
// so the advisor and this notification are never telling two different
// stories about the same stock item.
export async function checkPredictiveStockAlerts(
  stock: StockItem[],
  batches: Batch[],
  sales: Sale[]
): Promise<void> {
  if (Platform.OS === 'web') return;
  const runrates = computeRunrates(stock, batches, sales);
  const soon = projectedStockouts(runrates, 5);
  if (soon.length === 0) return;
  if (!(await canNotify('notif_predictive_stock'))) return;
  if (!(await requestNotificationPermission())) return;

  const title = '📉 Épuisement prévu bientôt';
  const body = soon.map((r) => `${r.name} : ~${r.daysOfCover}j restants`).join(', ');
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'notification.wav' },
    trigger: { channelId: ORNY_CHANNEL_ID },
  });
  logNotification({ title, body, kind: 'predictive_stock' }).catch(() => {});
  await markNotified('notif_predictive_stock');
}

export async function checkOverdueOrders(orders: CustomerOrder[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const today = new Date().toISOString().split('T')[0];
  const overdueLines = orders.filter((o) => o.status === 'pending' && o.deliveryDate < today);
  if (overdueLines.length === 0) return;
  // Dedupe by order — a multi-product order (see db/update26.sql) is
  // several rows sharing one orderGroupId, and should read as one late
  // order, not one per product line.
  const seen = new Set<string>();
  const overdue = overdueLines.filter((o) => (seen.has(o.orderGroupId) ? false : (seen.add(o.orderGroupId), true)));
  if (!(await canNotify('notif_orders'))) return;
  if (!(await requestNotificationPermission())) return;

  const title = '📦 Commandes en retard';
  const body = `${overdue.length} commande${overdue.length > 1 ? 's' : ''} non livrée${overdue.length > 1 ? 's' : ''} : ${overdue.map((o) => o.clientName).join(', ')}`;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'notification.wav' },
    trigger: { channelId: ORNY_CHANNEL_ID },
  });
  logNotification({ title, body, kind: 'orders' }).catch(() => {});
  await markNotified('notif_orders');
}

// Single entry point for all three checks above, reading straight from the
// local cache (never a network call, matching every other read-model in
// this app) — previously these three were only ever triggered from
// Dashboard's own load(), which meant deleting the Dashboard tab would have
// silently stopped every stock/order alert notification from ever firing
// again. Called from the app-level foreground listener in
// navigation/index.tsx instead, so it keeps running regardless of which
// screen is open or whether a "home" screen exists at all.
export async function runAlertChecks(): Promise<void> {
  const [stock, batches, sales, orders] = await Promise.all([
    getStock(), getBatches(), getSales(), getCustomerOrders(),
  ]);
  await checkStockAlerts(stock);
  await checkOverdueOrders(orders);
  await checkPredictiveStockAlerts(stock, batches, sales);
}
