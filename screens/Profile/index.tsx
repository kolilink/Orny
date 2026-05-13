import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Image, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { getProfile, saveProfile, saveAvatarFromUri } from '../../store/profile';

const C = {
  primary: '#1D9E75',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
  red: '#E24B4A',
};

const ROLE_LABELS = {
  admin: 'Administrateur',
  employee: 'Employé',
  investor: 'Investisseur',
};

export default function ProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, membership } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then(p => {
      setDisplayName(p.displayName);
      setAvatarUri(p.avatarUri);
      setLoading(false);
    });
  }, [user?.id]);

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la galerie.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = await saveAvatarFromUri(user!.id, result.assets[0].uri);
      setAvatarUri(uri);
    }
  }

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la caméra.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = await saveAvatarFromUri(user!.id, result.assets[0].uri);
      setAvatarUri(uri);
    }
  }

  function handleAvatarPress() {
    Alert.alert('Photo de profil', 'Choisir une source', [
      { text: 'Galerie photo', onPress: pickFromLibrary },
      { text: 'Appareil photo', onPress: pickFromCamera },
      ...(avatarUri ? [{ text: 'Supprimer la photo', style: 'destructive' as const, onPress: () => setAvatarUri(null) }] : []),
      { text: 'Annuler', style: 'cancel' },
    ]);
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
        <ActivityIndicator color={C.primary} />
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
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mon profil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar */}
        <TouchableOpacity style={styles.avatarWrap} onPress={handleAvatarPress} activeOpacity={0.8}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          )}
          <View style={styles.cameraBtn}>
            <Ionicons name="camera" size={15} color="#FFF" />
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
            placeholderTextColor={C.muted}
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
                <Text style={styles.readOnlyText}>{ROLE_LABELS[membership.role]}</Text>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#FFF" />
            : <Text style={styles.saveBtnText}>Enregistrer</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },

  content: { padding: 24, alignItems: 'center' },

  avatarWrap: { position: 'relative', marginBottom: 8 },
  avatar: { width: 104, height: 104, borderRadius: 52 },
  avatarPlaceholder: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 38, fontWeight: '800', color: '#FFF' },
  cameraBtn: {
    position: 'absolute', bottom: 2, right: 2,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.bg,
  },
  avatarHint: { fontSize: 12, color: C.muted, marginBottom: 28 },

  card: {
    width: '100%', backgroundColor: C.card, borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: C.border, marginBottom: 20,
  },
  label: {
    fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 15, color: C.text, backgroundColor: C.bg, marginBottom: 16,
  },
  readOnly: { backgroundColor: '#F0F0EE', justifyContent: 'center' },
  readOnlyText: { fontSize: 15, color: C.muted },

  saveBtn: {
    width: '100%', backgroundColor: C.primary,
    borderRadius: 14, padding: 16, alignItems: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
