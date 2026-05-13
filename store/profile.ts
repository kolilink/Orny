import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';

const keyAvatar = (userId: string) => `profile_avatar_uri_${userId}`;

export interface UserProfile {
  displayName: string;
  avatarUri: string | null;
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const [profileResult, avatar] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    AsyncStorage.getItem(keyAvatar(userId)),
  ]);
  return {
    displayName: profileResult.data?.display_name ?? '',
    avatarUri: avatar,
  };
}

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  await Promise.all([
    supabase.from('profiles').update({ display_name: profile.displayName }).eq('id', userId),
    profile.avatarUri
      ? AsyncStorage.setItem(keyAvatar(userId), profile.avatarUri)
      : AsyncStorage.removeItem(keyAvatar(userId)),
  ]);
}

export async function saveAvatarFromUri(userId: string, sourceUri: string): Promise<string> {
  const fileName = `avatar_${userId}_${Date.now()}.jpg`;
  const destPath = `${FileSystem.documentDirectory}${fileName}`;
  const oldUri = await AsyncStorage.getItem(keyAvatar(userId));
  if (oldUri) {
    await FileSystem.deleteAsync(oldUri, { idempotent: true }).catch(() => {});
  }
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  await AsyncStorage.setItem(keyAvatar(userId), destPath);
  return destPath;
}
