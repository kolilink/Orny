import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { getDocuments } from '../../store/documents';
import { BusinessDocument, RootStackParamList } from '../../types';
import { formatDate } from '../../utils/format';

type DocsNav = NativeStackNavigationProp<RootStackParamList>;

const CATEGORIES: { key: BusinessDocument['category'] | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'contrat', label: 'Contrats' },
  { key: 'facture', label: 'Factures' },
  { key: 'licence', label: 'Licences' },
  { key: 'import_export', label: 'Import/Export' },
  { key: 'investisseur', label: 'Investisseurs' },
  { key: 'autre', label: 'Autres' },
];

const CAT_COLORS: Record<BusinessDocument['category'], { bg: string; text: string }> = {
  contrat: { bg: '#EBF3FE', text: '#2D6BCE' },
  facture: { bg: '#FEF4E4', text: '#B7770A' },
  licence: { bg: '#E8F6F0', text: '#1D9E75' },
  import_export: { bg: '#E8F0FE', text: '#4A90D9' },
  investisseur: { bg: '#F3E8FE', text: '#8E44AD' },
  autre: { bg: '#F0F0EE', text: '#6B6B66' },
};

const CAT_LABELS: Record<BusinessDocument['category'], string> = {
  contrat: 'Contrat',
  facture: 'Facture',
  licence: 'Licence',
  import_export: 'Import/Export',
  investisseur: 'Investisseur',
  autre: 'Autre',
};

function daysUntilExpiry(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DocumentsScreen() {
  const navigation = useNavigation<DocsNav>();
  const [docs, setDocs] = useState<BusinessDocument[]>([]);
  const [filter, setFilter] = useState<BusinessDocument['category'] | 'all'>('all');

  const load = useCallback(async () => {
    const d = await getDocuments();
    setDocs(d);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === 'all' ? docs : docs.filter((d) => d.category === filter);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AddDocument')}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.chip, filter === cat.key && styles.chipActive]}
            onPress={() => setFilter(cat.key)}
          >
            <Text style={[styles.chipText, filter === cat.key && styles.chipTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun document trouvé.</Text>
        }
        renderItem={({ item }) => {
          const colors = CAT_COLORS[item.category];
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('DocumentDetail', { document: item })}
            >
              <View style={[styles.thumb, { backgroundColor: item.fileUri.startsWith('placeholder:')
                ? item.fileUri.replace('placeholder:', '') : '#E8E8E4' }]}
              >
                {!item.fileUri.startsWith('placeholder:') && (
                  <Ionicons name={item.fileType === 'pdf' ? 'document' : 'image'} size={24} color="#6B6B66" />
                )}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                <View style={styles.cardMeta}>
                  <View style={[styles.catBadge, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.catBadgeText, { color: colors.text }]}>
                      {CAT_LABELS[item.category]}
                    </Text>
                  </View>
                  <Text style={styles.cardDate}>{formatDate(item.dateAdded.split('T')[0])}</Text>
                </View>
                {!!item.notes && (
                  <Text style={styles.cardNotes} numberOfLines={2}>{item.notes}</Text>
                )}
                {!!item.expirationDate && (() => {
                  const days = daysUntilExpiry(item.expirationDate);
                  if (days < 0) {
                    return (
                      <View style={styles.expiryBadgeRed}>
                        <Ionicons name="alert-circle" size={12} color="#E24B4A" />
                        <Text style={styles.expiryTextRed}>Expirée</Text>
                      </View>
                    );
                  }
                  if (days <= 3) {
                    return (
                      <View style={styles.expiryBadgeOrange}>
                        <Ionicons name="warning" size={12} color="#EF9F27" />
                        <Text style={styles.expiryTextOrange}>
                          Expire dans {days === 0 ? "aujourd'hui" : `${days} jour${days > 1 ? 's' : ''}`}
                        </Text>
                      </View>
                    );
                  }
                  return null;
                })()}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F6' },
  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, paddingBottom: 8 },
  addBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#1D9E75',
    alignItems: 'center', justifyContent: 'center',
  },
  filterRow: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8E4',
  },
  chipActive: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  chipText: { fontSize: 13, color: '#6B6B66', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  list: { padding: 16, paddingTop: 4, paddingBottom: 32, gap: 12 },
  card: {
    flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1, borderColor: '#E8E8E4', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  thumb: { width: 80, minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: 12, gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A18', lineHeight: 20 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeText: { fontSize: 11, fontWeight: '600' },
  cardDate: { fontSize: 12, color: '#6B6B66' },
  cardNotes: { fontSize: 12, color: '#6B6B66', lineHeight: 16 },
  empty: { textAlign: 'center', color: '#6B6B66', marginTop: 40, fontSize: 15 },
  expiryBadgeRed: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FDECEA', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  expiryTextRed: { fontSize: 11, fontWeight: '600', color: '#E24B4A' },
  expiryBadgeOrange: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF4E4', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  expiryTextOrange: { fontSize: 11, fontWeight: '600', color: '#EF9F27' },
});
