import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Registers this device's Expo push token so the server-side
// dispatch-notification function can reach it later. Requires the app to be
// linked to an EAS project (`eas init`) — until then there's no projectId to
// mint a token with, so this silently no-ops and local notifications (which
// don't need a token) keep working exactly as before.
export async function registerPushToken(userId: string, factoryId: string): Promise<void> {
  if (Platform.OS === 'web') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        factory_id: factoryId,
        expo_push_token: token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' }
    );
  } catch (err) {
    console.warn('push token registration failed', err);
  }
}
