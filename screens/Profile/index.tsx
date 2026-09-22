import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, ROLE_LABELS } from '../../context/AuthContext';
import { getProfile, saveProfile, saveAvatarFromUri } from '../../store/profile';
import { Palette } from '../../theme/tokens';
import { useTheme, ColorSchemePreference } from '../../theme/ThemeContext';
import { AppModal, Text } from '../../components/ui';

const THEME_OPTIONS: { key: ColorSchemePreference; label: string }[] = [
  { key: 'light', label: 'Clair' },
  { key: 'dark', label: 'Sombre' },
  { key: 'system', label: 'Système' },
];

const keyAvatar = (userId: string) => `profile_avatar_uri_${userId}`;

// On web: convert blob URL → base64 data URL so it survives page refresh
async function webBlobToDataUrl(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, membership } = useAuth();
  const { palette, colorScheme, setColorScheme } = useTheme();
  const styles = makeStyles(palette);
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photoModal, setPhotoModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then(p => {
      setDisplayName(p.displayName);
      setAvatarUri(p.avatarUri);
      setLoading(false);
    });
  }, [user?.id]);

  async function pickFromLibrary() {
    setPhotoModal(false);
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', "Autorisez l'accès à la galerie.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const rawUri = result.assets[0].uri;
      if (Platform.OS === 'web') {
        const dataUrl = rawUri.startsWith('data:') ? rawUri : await webBlobToDataUrl(rawUri);
        await AsyncStorage.setItem(keyAvatar(user!.id), dataUrl);
        setAvatarUri(dataUrl);
      } else {
        const uri = await saveAvatarFromUri(user!.id, rawUri);
        setAvatarUri(uri);
      }
    }
  }

  async function pickFromCamera() {
    setPhotoModal(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la caméra.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = await saveAvatarFromUri(user!.id, result.assets[0].uri);
      setAvatarUri(uri);
    }
  }

  async function removeAvatar() {
    setPhotoModal(false);
    setAvatarUri(null);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    await saveProfile(user.id, { displayName: displayName.trim(), avatarUri });
    setSaving(false);
    navigation.goBack();
  }

  const initials = displayName.trim()
    ? displayName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? '?').toUpperCase();

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={palette.moss} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mon profil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar */}
        <TouchableOpacity style={styles.avatarWrap} onPress={() => setPhotoModal(true)} activeOpacity={0.8}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          )}
          <View style={styles.cameraBtn}>
            <Ionicons name="camera" size={15} color={palette.white} />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>Appuyer pour modifier</Text>

        {/* Fields */}
        <View style={styles.card}>
          <Text style={styles.label}>Nom d'affichage</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Votre nom"
            placeholderTextColor={palette.muted}
            maxLength={40}
            returnKeyType="done"
          />

          <Text style={styles.label}>Email</Text>
          <View style={[styles.input, styles.readOnly]}>
            <Text style={styles.readOnlyText}>{user?.email ?? '—'}</Text>
          </View>

          {membership && (
            <>
              <Text style={styles.label}>Rôle actuel</Text>
              <View style={[styles.input, styles.readOnly, { marginBottom: 0 }]}>
                <Text style={styles.readOnlyText}>{ROLE_LABELS[membership.role] ?? membership.role}</Text>
              </View>
            </>
          )}
        </View>

        {/* Paramètres — personal preferences only (Claude's own language/
            lecture-automatique controls live on that screen itself,
            not here — this screen is just picture, name, email, role, and
            display preferences). */}
        <View style={styles.card}>
          <Text style={styles.label}>Paramètres</Text>
          <View style={styles.langRow}>
            {THEME_OPTIONS.map(opt => {
              const active = colorScheme === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.langChip, active && styles.langChipActive]}
                  onPress={() => setColorScheme(opt.key)}
                >
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={palette.white} />
            : <Text style={styles.saveBtnText}>Enregistrer</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Photo picker — replaces Alert.alert (broken on web) */}
      <AppModal visible={photoModal} onClose={() => setPhotoModal(false)} title="Photo de profil">
        <TouchableOpacity
          style={[styles.modalOption, Platform.OS === 'web' && !avatarUri && styles.modalOptionLast]}
          onPress={pickFromLibrary}
        >
          <Ionicons name="images-outline" size={22} color={palette.moss} style={{ marginRight: 14 }} />
          <Text style={styles.modalOptionText}>Galerie photo</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' && (
          <TouchableOpacity style={[styles.modalOption, !avatarUri && styles.modalOptionLast]} onPress={pickFromCamera}>
            <Ionicons name="camera-outline" size={22} color={palette.moss} style={{ marginRight: 14 }} />
            <Text style={styles.modalOptionText}>Appareil photo</Text>
          </TouchableOpacity>
        )}
        {avatarUri && (
          <TouchableOpacity style={[styles.modalOption, styles.modalOptionLast]} onPress={removeAvatar}>
            <Ionicons name="trash-outline" size={22} color={palette.critical} style={{ marginRight: 14 }} />
            <Text style={[styles.modalOptionText, { color: palette.critical }]}>Supprimer la photo</Text>
          </TouchableOpacity>
        )}
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  centered: { justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: palette.card, borderBottomWidth: 1, borderColor: palette.line,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.ink },

  content: { padding: 24, alignItems: 'center' },

  avatarWrap: { position: 'relative', marginBottom: 8 },
  avatar: { width: 104, height: 104, borderRadius: 52 },
  avatarPlaceholder: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 38, fontWeight: '800', color: palette.white },
  cameraBtn: {
    position: 'absolute', bottom: 2, right: 2,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.paper,
  },
  avatarHint: { fontSize: 12, color: palette.muted, marginBottom: 28 },

  card: {
    width: '100%', backgroundColor: palette.card, borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: palette.line, marginBottom: 20,
  },
  label: {
    fontSize: 11, fontWeight: '700', color: palette.muted, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1, borderColor: palette.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 15, color: palette.ink, backgroundColor: palette.paper, marginBottom: 16,
  },
  readOnly: { backgroundColor: palette.line, justifyContent: 'center' },
  readOnlyText: { fontSize: 15, color: palette.muted },

  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  langChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper,
  },
  langChipActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  langChipText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  langChipTextActive: { color: palette.white },

  saveBtn: {
    width: '100%', backgroundColor: palette.moss,
    borderRadius: 14, padding: 16, alignItems: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: palette.white },

  modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: palette.line },
  modalOptionLast: { borderBottomWidth: 0 },
  modalOptionText: { fontSize: 16, color: palette.ink, fontWeight: '500' },
});
