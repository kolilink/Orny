import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StockItem, CustomerOrder } from '../types';

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
  if (status === 'granted') return true;
  const { status: asked } = await Notifications.requestPermissionsAsync();
  return asked === 'granted';
}

export async function checkStockAlerts(items: StockItem[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const critical = items.filter((i) => i.currentLevel <= 0);
  const low = items.filter((i) => i.currentLevel > 0 && i.currentLevel <= i.alertThreshold);
  if (critical.length === 0 && low.length === 0) return;
  if (!(await canNotify('notif_stock'))) return;
  if (!(await requestNotificationPermission())) return;

  if (critical.length > 0) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚨 Stock épuisé',
        body: critical.map((i) => i.name).join(', '),
      },
      trigger: null,
    });
  }
  if (low.length > 0) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Stock bas',
        body: low.map((i) => `${i.name} : ${i.currentLevel} ${i.unit}`).join(', '),
      },
      trigger: null,
    });
  }
  await markNotified('notif_stock');
}

export async function checkOverdueOrders(orders: CustomerOrder[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const today = new Date().toISOString().split('T')[0];
  const overdue = orders.filter((o) => o.status === 'pending' && o.deliveryDate < today);
  if (overdue.length === 0) return;
  if (!(await canNotify('notif_orders'))) return;
  if (!(await requestNotificationPermission())) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '📦 Commandes en retard',
      body: `${overdue.length} commande${overdue.length > 1 ? 's' : ''} non livrée${overdue.length > 1 ? 's' : ''} : ${overdue.map((o) => o.clientName).join(', ')}`,
    },
    trigger: null,
  });
  await markNotified('notif_orders');
}
