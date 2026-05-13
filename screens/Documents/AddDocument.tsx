import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { addDocument } from '../../store/documents';
import { BusinessDocument } from '../../types';

const CATEGORIES: { key: BusinessDocument['category']; label: string }[] = [
  { key: 'contrat', label: 'Contrat' },
  { key: 'facture', label: 'Facture' },
  { key: 'licence', label: 'Licence' },
  { key: 'import_export', label: 'Import/Export' },
  { key: 'investisseur', label: 'Investisseur' },
  { key: 'autre', label: 'Autre' },
];

export default function AddDocumentScreen() {
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
          placeholder="Ex: Contrat fournisseur emballages"
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
            <Ionicons name="camera" size={22} color="#1D9E75" />
            <Text style={styles.fileBtnText}>Prendre une{'\n'}photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fileBtn} onPress={pickFromGallery}>
            <Ionicons name="images" size={22} color="#1D9E75" />
            <Text style={styles.fileBtnText}>Galerie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fileBtn} onPress={pickFile}>
            <Ionicons name="folder-open" size={22} color="#1D9E75" />
            <Text style={styles.fileBtnText}>Fichier{'\n'}/ PDF</Text>
          </TouchableOpacity>
        </View>
        {!!fileUri && (
          <View style={styles.filePreview}>
            <Ionicons name="checkmark-circle" size={18} color="#1D9E75" />
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
          placeholder="Ex: chine, emballages, 2026"
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F6' },
  content: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#1A1A18', marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1,
    borderColor: '#E8E8E4', padding: 14, fontSize: 16, color: '#1A1A18',
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8E4',
  },
  catBtnActive: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  catBtnText: { fontSize: 14, color: '#6B6B66', fontWeight: '500' },
  catBtnTextActive: { color: '#FFFFFF', fontWeight: '600' },
  fileGrid: { flexDirection: 'row', gap: 8 },
  fileBtn: {
    flex: 1, minHeight: 72, backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1, borderColor: '#E8E8E4', alignItems: 'center',
    justifyContent: 'center', gap: 6, paddingVertical: 10,
  },
  fileBtnText: { fontSize: 12, color: '#1D9E75', fontWeight: '600', textAlign: 'center' },
  filePreview: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filePreviewText: { fontSize: 13, color: '#1D9E75', flex: 1 },
  submitBtn: {
    backgroundColor: '#1D9E75', borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
