import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Text } from '../../components/ui';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { addDocument } from '../../store/documents';
import { BusinessDocument } from '../../types';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

// Web-only: prompts browser file picker, resolves to a base64 data URL (persists across refresh)
function webPickFromDisk(accept: string, capture?: string): Promise<{ uri: string; mimeType: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onloadend = () => resolve({ uri: reader.result as string, mimeType: file.type });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const CATEGORIES: { key: BusinessDocument['category']; label: string }[] = [
  { key: 'contrat', label: 'Contrat' },
  { key: 'facture', label: 'Facture' },
  { key: 'licence', label: 'Licence' },
  { key: 'import_export', label: 'Import/Export' },
  { key: 'investisseur', label: 'Investisseur' },
  { key: 'autre', label: 'Autre' },
];

export default function AddDocumentScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<BusinessDocument['category']>('contrat');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [fileUri, setFileUri] = useState('');
  const [fileType, setFileType] = useState<BusinessDocument['fileType']>('image');
  const [expiryInput, setExpiryInput] = useState('');
  const [saving, setSaving] = useState(false);

  const takePhoto = async () => {
    if (Platform.OS === 'web') {
      try {
        const result = await webPickFromDisk('image/*', 'environment');
        if (result) { setFileUri(result.uri); setFileType('image'); }
      } catch (e) {
        Alert.alert('Erreur', `Impossible d'ouvrir la caméra. ${String(e)}`);
      }
      return;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', 'Accès à la caméra requis.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setFileUri(result.assets[0].uri);
        setFileType('image');
      }
    } catch (e) {
      Alert.alert('Erreur', `Impossible d'ouvrir la caméra. ${String(e)}`);
    }
  };

  const pickFromGallery = async () => {
    if (Platform.OS === 'web') {
      try {
        const result = await webPickFromDisk('image/*');
        if (result) { setFileUri(result.uri); setFileType('image'); }
      } catch (e) {
        Alert.alert('Erreur', `Impossible d'ouvrir la galerie. ${String(e)}`);
      }
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', 'Accès à la galerie requis.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setFileUri(result.assets[0].uri);
        setFileType('image');
      }
    } catch (e) {
      Alert.alert('Erreur', `Impossible d'ouvrir la galerie. ${String(e)}`);
    }
  };

  const pickFile = async () => {
    if (Platform.OS === 'web') {
      try {
        const result = await webPickFromDisk('.pdf,image/*');
        if (result) {
          setFileUri(result.uri);
          setFileType(result.mimeType.includes('pdf') ? 'pdf' : 'image');
        }
      } catch (e) {
        Alert.alert('Erreur', `Impossible d'ouvrir le sélecteur de fichiers. ${String(e)}`);
      }
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        setFileUri(result.assets[0].uri);
        setFileType(result.assets[0].mimeType?.includes('pdf') ? 'pdf' : 'image');
      }
    } catch (e) {
      Alert.alert('Erreur', `Impossible d'ouvrir le sélecteur de fichiers. ${String(e)}`);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Erreur', 'Le titre est obligatoire.');
      return;
    }

    let parsedExpiry: string | undefined;
    if (category === 'licence' && expiryInput.trim()) {
      const parts = expiryInput.trim().split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        parsedExpiry = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      } else {
        Alert.alert('Erreur', 'Format de date invalide. Utilisez JJ/MM/AAAA (ex: 15/06/2027).');
        return;
      }
    }

    setSaving(true);
    try {
      await addDocument(
        {
          title: title.trim(),
          category,
          fileType,
          notes: notes.trim(),
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          expirationDate: parsedExpiry,
        },
        fileUri || 'placeholder:#6B6B66'
      );
      navigation.goBack();
    } catch (e) {
      Alert.alert('Erreur', `Impossible d'enregistrer le document. ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.label}>Titre *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Catégorie</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={[styles.catBtn, category === cat.key && styles.catBtnActive]}
              onPress={() => setCategory(cat.key)}
            >
              <Text style={[styles.catBtnText, category === cat.key && styles.catBtnTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {category === 'licence' && (
          <>
            <Text style={styles.label}>Date d'expiration</Text>
            <TextInput
              style={styles.input}
              placeholder="JJ/MM/AAAA  (ex: 15/06/2027)"
              value={expiryInput}
              onChangeText={setExpiryInput}
              keyboardType="numeric"
            />
          </>
        )}

        <Text style={styles.label}>Fichier</Text>
        <View style={styles.fileGrid}>
          <TouchableOpacity style={styles.fileBtn} onPress={takePhoto}>
            <Ionicons name="camera" size={22} color={palette.moss} />
            <Text style={styles.fileBtnText}>Prendre une{'\n'}photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fileBtn} onPress={pickFromGallery}>
            <Ionicons name="images" size={22} color={palette.moss} />
            <Text style={styles.fileBtnText}>Galerie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fileBtn} onPress={pickFile}>
            <Ionicons name="folder-open" size={22} color={palette.moss} />
            <Text style={styles.fileBtnText}>Fichier{'\n'}/ PDF</Text>
          </TouchableOpacity>
        </View>
        {!!fileUri && (
          <View style={styles.filePreview}>
            <Ionicons name="checkmark-circle" size={18} color={palette.moss} />
            <Text style={styles.filePreviewText} numberOfLines={1}>
              {fileType === 'pdf' ? 'PDF sélectionné' : 'Photo sélectionnée'}
            </Text>
          </View>
        )}

        <Text style={styles.label}>Notes (optionnel)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Ajouter une note…"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <Text style={styles.label}>Tags (séparés par des virgules)</Text>
        <TextInput
          style={styles.input}
          placeholder="chine, emballages"
          value={tags}
          onChangeText={setTags}
        />

        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.submitText}>
            {saving ? 'Enregistrement…' : 'Enregistrer le document'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: palette.white, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line,
  },
  catBtnActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  catBtnText: { fontSize: 14, color: palette.muted, fontWeight: '500' },
  catBtnTextActive: { color: palette.white, fontWeight: '600' },
  fileGrid: { flexDirection: 'row', gap: 8 },
  fileBtn: {
    flex: 1, minHeight: 72, backgroundColor: palette.white, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, alignItems: 'center',
    justifyContent: 'center', gap: 6, paddingVertical: 10,
  },
  fileBtnText: { fontSize: 12, color: palette.moss, fontWeight: '600', textAlign: 'center' },
  filePreview: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filePreviewText: { fontSize: 13, color: palette.moss, flex: 1 },
  submitBtn: {
    backgroundColor: palette.moss, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: palette.white, fontSize: 16, fontWeight: '700' },
});
