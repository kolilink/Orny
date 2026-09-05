import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { LanguageCode } from '../utils/voice';

const keyAvatar = (userId: string) => `profile_avatar_uri_${userId}`;

export interface UserProfile {
  displayName: string;
  avatarUri: string | null;
  preferredLanguage: LanguageCode | null;
  voiceAutoplay: boolean;
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const [profileResult, avatar] = await Promise.all([
    supabase.from('profiles').select('display_name, preferred_language, voice_autoplay').eq('id', userId).maybeSingle(),
    AsyncStorage.getItem(keyAvatar(userId)),
  ]);
  return {
    displayName: profileResult.data?.display_name ?? '',
    avatarUri: avatar,
    preferredLanguage: (profileResult.data?.preferred_language as LanguageCode | null) ?? null,
    voiceAutoplay: profileResult.data?.voice_autoplay ?? false,
  };
}

export async function saveProfile(
  userId: string,
  profile: Pick<UserProfile, 'displayName' | 'avatarUri'>
): Promise<void> {
  await Promise.all([
    supabase.from('profiles').update({ display_name: profile.displayName }).eq('id', userId),
    profile.avatarUri
      ? AsyncStorage.setItem(keyAvatar(userId), profile.avatarUri)
      : AsyncStorage.removeItem(keyAvatar(userId)),
  ]);
}

export async function saveVoicePreferences(
  userId: string,
  prefs: { preferredLanguage: LanguageCode | null; voiceAutoplay: boolean }
): Promise<void> {
  await supabase
    .from('profiles')
    .update({ preferred_language: prefs.preferredLanguage, voice_autoplay: prefs.voiceAutoplay })
    .eq('id', userId);
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
