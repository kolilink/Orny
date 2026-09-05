import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Alert, Platform,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { RootStackParamList, BusinessDocument } from '../../types';
import { getSignedDocumentUrl } from '../../store/documents';
import { formatDate } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type DetailRoute = RouteProp<RootStackParamList, 'DocumentDetail'>;

const CAT_LABELS: Record<BusinessDocument['category'], string> = {
  contrat: 'Contrat',
  facture: 'Facture',
  licence: 'Licence',
  import_export: 'Import/Export',
  investisseur: 'Investisseur',
  autre: 'Autre',
};

const makeCatColors = (palette: Palette): Record<BusinessDocument['category'], { bg: string; text: string }> => ({
  contrat: { bg: palette.infoSoft, text: palette.infoDeep },
  facture: { bg: palette.cautionSoft, text: palette.caution },
  licence: { bg: palette.mossSoft, text: palette.mossDeep },
  import_export: { bg: palette.tealSoft, text: palette.tealDeep },
  investisseur: { bg: palette.violetSoft, text: palette.violetDeep },
  autre: { bg: palette.line, text: palette.muted },
});

function expiryStyle(dateStr: string, palette: Palette): object {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { color: palette.critical };
  if (days <= 3) return { color: palette.caution };
  return {};
}

export default function DocumentDetailScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const CAT_COLORS = makeCatColors(palette);
  const { params } = useRoute<DetailRoute>();
  const doc = params.document;
  const colors = CAT_COLORS[doc.category];

  const isPlaceholder = doc.fileUri.startsWith('placeholder:');
  const placeholderColor = isPlaceholder ? doc.fileUri.replace('placeholder:', '') : palette.line;

  // The local fileUri only ever exists on the device that uploaded it. If
  // it's missing here (a different device, or a reinstall), fall back to a
  // freshly-signed Supabase Storage URL — everything below renders either
  // kind of URI identically, so no other branching is needed.
  const [displayUri, setDisplayUri] = useState(doc.fileUri);

  useEffect(() => {
    if (isPlaceholder || Platform.OS === 'web' || !doc.storagePath) return;
    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(doc.fileUri);
        if (info.exists) return;
      } catch { /* fall through to signed URL */ }
      const signed = await getSignedDocumentUrl(doc.storagePath!);
      if (signed) setDisplayUri(signed);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenFile = async () => {
    if (isPlaceholder) {
      Alert.alert('Aperçu', 'Ce document est un exemple. Ajoutez un vrai fichier pour l\'ouvrir.');
      return;
    }
    try {
      if (Platform.OS === 'web') {
        // fileUri is a base64 data URL stored by the web file picker
        const uri = displayUri;
        if (uri.startsWith('data:')) {
          const [header, b64] = uri.split(',');
          const mime = header.split(':')[1].split(';')[0];
          const bytes = atob(b64);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          const blob = new Blob([arr], { type: mime });
          (window as any).open(URL.createObjectURL(blob), '_blank');
        } else {
          (window as any).open(uri, '_blank');
        }
      } else {
        await Linking.openURL(displayUri);
      }
    } catch {
      Alert.alert('Impossible d\'ouvrir', 'Le fichier n\'est plus disponible. Essayez de le ré-ajouter.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {isPlaceholder ? (
        <View style={[styles.placeholder, { backgroundColor: placeholderColor }]}>
          <Ionicons
            name={doc.fileType === 'pdf' ? 'document-text' : 'image'}
            size={48}
            color="rgba(255,255,255,0.8)"
          />
          <Text style={styles.placeholderLabel}>
            {doc.fileType === 'pdf' ? 'Document PDF (exemple)' : 'Image (exemple)'}
          </Text>
        </View>
      ) : doc.fileType === 'image' ? (
        <Image source={{ uri: displayUri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.placeholder, { backgroundColor: palette.line }]}>
          <Ionicons name="document-text" size={48} color={palette.muted} />
          <Text style={styles.pdfLabel}>Fichier PDF</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title}>{doc.title}</Text>

        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: colors.bg }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>
              {CAT_LABELS[doc.category]}
            </Text>
          </View>
          <Text style={styles.date}>{formatDate(doc.dateAdded.split('T')[0])}</Text>
        </View>

        <TouchableOpacity style={styles.openBtn} onPress={handleOpenFile}>
          <Ionicons name="open-outline" size={18} color={palette.white} />
          <Text style={styles.openBtnText}>
            {doc.fileType === 'pdf' ? 'Ouvrir le PDF' : 'Ouvrir l\'image'}
          </Text>
        </TouchableOpacity>

        {!!doc.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.sectionText}>{doc.notes}</Text>
          </View>
        )}

        {doc.tags.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagsRow}>
              {doc.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informations</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Type de fichier</Text>
            <Text style={styles.infoValue}>{doc.fileType.toUpperCase()}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Date d'ajout</Text>
            <Text style={styles.infoValue}>{formatDate(doc.dateAdded.split('T')[0])}</Text>
          </View>
          {!!doc.expirationDate && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date d'expiration</Text>
              <Text style={[styles.infoValue, expiryStyle(doc.expirationDate, palette)]}>
                {formatDate(doc.expirationDate)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { paddingBottom: 40 },
  placeholder: {
    height: 200, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  placeholderLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600' },
  pdfLabel: { color: palette.muted, fontSize: 14, marginTop: 8 },
  image: { height: 240, width: '100%' },
  body: { padding: 20, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', color: palette.ink, lineHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  date: { fontSize: 13, color: palette.muted },
  openBtn: {
    backgroundColor: palette.moss, borderRadius: 12, height: 50,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  openBtnText: { fontSize: 15, color: palette.white, fontWeight: '700' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionText: { fontSize: 15, color: palette.ink, lineHeight: 22 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: palette.white, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: palette.line },
  tagText: { fontSize: 13, color: palette.muted },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderColor: palette.line,
  },
  infoLabel: { fontSize: 14, color: palette.muted },
  infoValue: { fontSize: 14, fontWeight: '600', color: palette.ink },
});
