import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Alert,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, BusinessDocument } from '../../types';
import { formatDate } from '../../utils/format';

type DetailRoute = RouteProp<RootStackParamList, 'DocumentDetail'>;

const CAT_LABELS: Record<BusinessDocument['category'], string> = {
  contrat: 'Contrat',
  facture: 'Facture',
  licence: 'Licence',
  import_export: 'Import/Export',
  investisseur: 'Investisseur',
  autre: 'Autre',
};

const CAT_COLORS: Record<BusinessDocument['category'], { bg: string; text: string }> = {
  contrat: { bg: '#EBF3FE', text: '#2D6BCE' },
  facture: { bg: '#FEF4E4', text: '#B7770A' },
  licence: { bg: '#E8F6F0', text: '#1D9E75' },
  import_export: { bg: '#E8F0FE', text: '#4A90D9' },
  investisseur: { bg: '#F3E8FE', text: '#8E44AD' },
  autre: { bg: '#F0F0EE', text: '#6B6B66' },
};

function expiryStyle(dateStr: string): object {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { color: '#E24B4A' };
  if (days <= 3) return { color: '#EF9F27' };
  return {};
}

export default function DocumentDetailScreen() {
  const { params } = useRoute<DetailRoute>();
  const doc = params.document;
  const colors = CAT_COLORS[doc.category];

  const isPlaceholder = doc.fileUri.startsWith('placeholder:');
  const placeholderColor = isPlaceholder ? doc.fileUri.replace('placeholder:', '') : '#E8E8E4';

  const handleOpenFile = async () => {
    if (isPlaceholder) {
      Alert.alert('Aperçu', 'Ce document est un exemple. Ajoutez un vrai fichier pour l\'ouvrir.');
      return;
    }
    try {
      const supported = await Linking.canOpenURL(doc.fileUri);
      if (supported) {
        await Linking.openURL(doc.fileUri);
      } else {
        Alert.alert('Impossible d\'ouvrir', 'Aucune application disponible pour ouvrir ce fichier.');
      }
    } catch {
      Alert.alert('Erreur', 'Impossible d\'ouvrir le fichier.');
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
        <Image source={{ uri: doc.fileUri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.placeholder, { backgroundColor: '#F0F0EE' }]}>
          <Ionicons name="document-text" size={48} color="#6B6B66" />
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
          <Ionicons name="open-outline" size={18} color="#FFFFFF" />
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
              <Text style={[styles.infoValue, expiryStyle(doc.expirationDate)]}>
                {formatDate(doc.expirationDate)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F6' },
  content: { paddingBottom: 40 },
  placeholder: {
    height: 200, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  placeholderLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600' },
  pdfLabel: { color: '#6B6B66', fontSize: 14, marginTop: 8 },
  image: { height: 240, width: '100%' },
  body: { padding: 20, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#1A1A18', lineHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  date: { fontSize: 13, color: '#6B6B66' },
  openBtn: {
    backgroundColor: '#1D9E75', borderRadius: 12, height: 50,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  openBtnText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B6B66', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionText: { fontSize: 15, color: '#1A1A18', lineHeight: 22 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#E8E8E4' },
  tagText: { fontSize: 13, color: '#6B6B66' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F0F0EE',
  },
  infoLabel: { fontSize: 14, color: '#6B6B66' },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1A1A18' },
});
