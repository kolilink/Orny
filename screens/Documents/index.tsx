import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { AppModal, Text } from '../../components/ui';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { getDocuments, syncDocumentsFromSupabase } from '../../store/documents';
import { BusinessDocument, RootStackParamList } from '../../types';
import { formatDate } from '../../utils/format';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { CATEGORIES, CAT_LABELS, makeCatColors } from './categoryConfig';
import { Palette } from '../../theme/tokens';

type DocsNav = NativeStackNavigationProp<RootStackParamList>;

function daysUntilExpiry(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DocumentsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const CAT_COLORS = makeCatColors(palette);
  const navigation = useNavigation<DocsNav>();
  const { membership } = useAuth();
  const canWrite = membership?.role !== 'inspecteur';
  const [docs, setDocs] = useState<BusinessDocument[]>([]);
  const [filter, setFilter] = useState<BusinessDocument['category'] | 'all'>('all');
  const [filterModal, setFilterModal] = useState(false);

  // Cache-first: this used to never sync at all, relying entirely on
  // whatever was last cached locally — a document uploaded from another
  // device would never appear here. Now renders cache instantly, then
  // syncs and re-renders once fresh data lands.
  const load = useCallback(async () => {
    setDocs(await getDocuments());
    await syncDocumentsFromSupabase();
    setDocs(await getDocuments());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === 'all' ? docs : docs.filter((d) => d.category === filter);

  // A filter only earns a place on screen once there's actually more than
  // one real category to tell apart — with one category (or none), "Tous"
  // and that category would show the exact same list, so the control
  // would be pure decoration. Counts come from the real documents on hand,
  // not the static category list, so an unused category never appears.
  const usedCategories = CATEGORIES.filter(
    (c) => c.key !== 'all' && docs.some((d) => d.category === c.key)
  );
  const activeLabel = CATEGORIES.find((c) => c.key === filter)?.label ?? 'Tous';

  // "+" lives in the native header, like every other now-migrated list
  // screen — this used to be its own row under the header instead.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => canWrite ? (
        <TouchableOpacity onPress={() => navigation.navigate('AddDocument')} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ) : null,
    });
  }, [navigation, canWrite, palette.moss]);

  return (
    <View style={styles.container}>
      {/* One small, honest control instead of a permanent 7-wide chip row —
          it only appears once there's more than one real category to tell
          apart (see usedCategories above), and it shows the current state
          instead of hiding it behind an icon. */}
      {usedCategories.length > 1 && (
        <TouchableOpacity style={styles.filterPill} onPress={() => setFilterModal(true)}>
          <Text style={styles.filterPillText}>{activeLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={palette.muted} />
        </TouchableOpacity>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={usedCategories.length > 1 ? undefined : { marginTop: 12 }}
        contentContainerStyle={filtered.length > 0 ? styles.listContent : styles.list}
        ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
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
              <View style={[
                styles.thumb,
                { backgroundColor: item.fileType === 'pdf' ? palette.criticalSoft : palette.infoSoft },
              ]}>
                <Ionicons
                  name={item.fileType === 'pdf' ? 'document-text' : 'image-outline'}
                  size={30}
                  color={item.fileType === 'pdf' ? palette.critical : palette.infoDeep}
                />
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
                        <Ionicons name="alert-circle" size={12} color={palette.critical} />
                        <Text style={styles.expiryTextRed}>Expirée</Text>
                      </View>
                    );
                  }
                  if (days <= 3) {
                    return (
                      <View style={styles.expiryBadgeOrange}>
                        <Ionicons name="warning" size={12} color={palette.caution} />
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

      <AppModal visible={filterModal} onClose={() => setFilterModal(false)} title="Filtrer par catégorie">
        <TouchableOpacity
          style={styles.filterRowItem}
          onPress={() => { setFilter('all'); setFilterModal(false); }}
        >
          <Text style={styles.filterRowLabel}>Tous</Text>
          <Text style={styles.filterRowCount}>{docs.length}</Text>
          {filter === 'all' && <Ionicons name="checkmark" size={18} color={palette.moss} style={{ marginLeft: 8 }} />}
        </TouchableOpacity>
        {usedCategories.map((cat) => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.filterRowItem, styles.filterRowDivider]}
            onPress={() => { setFilter(cat.key as BusinessDocument['category']); setFilterModal(false); }}
          >
            <Text style={styles.filterRowLabel}>{cat.label}</Text>
            <Text style={styles.filterRowCount}>{docs.filter((d) => d.category === cat.key).length}</Text>
            {filter === cat.key && <Ionicons name="checkmark" size={18} color={palette.moss} style={{ marginLeft: 8 }} />}
          </TouchableOpacity>
        ))}
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  filterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
  },
  filterPillText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  filterRowItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  filterRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  filterRowLabel: { flex: 1, fontSize: 15, color: palette.ink },
  filterRowCount: { fontSize: 13, color: palette.muted },
  list: { padding: 16, paddingTop: 4, paddingBottom: 32 },
  // One shared card wraps the whole list; rows are flat, divided by
  // rowDivider — not individually bordered/shadowed.
  listContent: {
    margin: 16, marginTop: 4, backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  card: { flexDirection: 'row' },
  thumb: { width: 80, minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: 12, gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: palette.ink, lineHeight: 20 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeText: { fontSize: 11, fontWeight: '600' },
  cardDate: { fontSize: 12, color: palette.muted },
  cardNotes: { fontSize: 12, color: palette.muted, lineHeight: 16 },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15 },
  expiryBadgeRed: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.criticalSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  expiryTextRed: { fontSize: 11, fontWeight: '600', color: palette.critical },
  expiryBadgeOrange: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.cautionSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  expiryTextOrange: { fontSize: 11, fontWeight: '600', color: palette.caution },
});
