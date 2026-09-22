import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getBulks, addBulk, updateBulk, deleteBulk, syncBulksFromSupabase } from '../../store/bulks';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { BulkProduct, ProductFlavor } from '../../types';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, Text } from '../../components/ui';

type FormState = { name: string; flavorId: string; bagCount: string; unitPrice: string };
const EMPTY_FORM: FormState = { name: '', flavorId: '', bagCount: '15', unitPrice: '' };

export default function BulksScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation();
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BulkProduct | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BulkProduct | null>(null);

  // Cache-first: render instantly from cache, then sync and re-render.
  const load = useCallback(async () => {
    const [b, f] = await Promise.all([getBulks(), getFlavors()]);
    setBulksState(b);
    setFlavorsState(f);

    await Promise.all([syncBulksFromSupabase(), syncFlavorsFromSupabase()]);
    const [freshB, freshF] = await Promise.all([getBulks(), getFlavors()]);
    setBulksState(freshB);
    setFlavorsState(freshF);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flavorLabel = (flavorId: string): string =>
    flavors.find((f) => f.id === flavorId)?.label ?? flavorId;

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, flavorId: flavors[0]?.id ?? '' });
    setShowModal(true);
  };

  const openEdit = (b: BulkProduct) => {
    setEditing(b);
    setForm({
      name: b.name,
      flavorId: b.flavorId,
      bagCount: String(b.bagCount),
      unitPrice: String(b.unitPrice),
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Erreur', 'Le nom du vrac est obligatoire.');
      return;
    }
    if (!form.flavorId) {
      Alert.alert('Erreur', 'Sélectionnez une saveur.');
      return;
    }
    setSaving(true);
    try {
      const bagCount = parseInt(form.bagCount) || 1;
      const unitPrice = parseInt(form.unitPrice) || 0;
      if (editing) {
        await updateBulk(editing.id, {
          name: form.name.trim(),
          flavorId: form.flavorId,
          bagCount,
          unitPrice,
        });
      } else {
        await addBulk({
          name: form.name.trim(),
          flavorId: form.flavorId,
          bagCount,
          unitPrice,
          recipePerUnit: [],
        });
      }
      await load();
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (b: BulkProduct) => {
    setDeleteTarget(b);
  };

  // Title + count and the "+" both live in the native header (this screen
  // has one — see the rule in navigation/index.tsx), not duplicated below.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Lots</Text>
          <Text style={styles.headerCount}>{bulks.length} lot{bulks.length !== 1 ? 's' : ''}</Text>
        </View>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={openAdd} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, bulks.length, palette.moss]);

  return (
    <View style={styles.container}>

      {flavors.length === 0 && (
        <View style={styles.warningBanner}>
          <Ionicons name="information-circle-outline" size={16} color={palette.caution} />
          <Text style={styles.warningText}>Créez d'abord des saveurs dans Menu &gt; Saveurs</Text>
        </View>
      )}

      <FlatList
        data={bulks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={bulks.length > 0 ? styles.listContent : styles.list}
        ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="layers-outline" size={48} color={palette.muted} />
            <Text style={styles.emptyText}>Aucun lot défini</Text>
            <Text style={styles.emptyHint}>Créez un lot pour vendre en vrac</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulkName}>{item.name}</Text>
                <Text style={styles.bulkMeta}>
                  {item.bagCount} sachets · {flavorLabel(item.flavorId)}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                  <Ionicons name="pencil-outline" size={18} color={palette.moss} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item)}>
                  <Ionicons name="trash-outline" size={18} color={palette.critical} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Prix</Text>
              <Text style={styles.priceValue}>{formatGNF(item.unitPrice)}</Text>
            </View>
          </View>
        )}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteBulk(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer ce vrac ?"
        message={deleteTarget ? `"${deleteTarget.name}" sera supprimé.` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Add / Edit */}
      <AppModal visible={showModal} onClose={() => setShowModal(false)} title={editing ? 'Modifier le lot' : 'Nouveau lot'}>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom du lot *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Vrac 15, Lot Standard"
            placeholderTextColor={palette.muted}
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            autoFocus
          />

          <Text style={styles.fieldLabel}>Saveur</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {flavors.map((fl) => (
                <TouchableOpacity
                  key={fl.id}
                  style={[
                    styles.flavorPill,
                    form.flavorId === fl.id && styles.flavorPillActive,
                  ]}
                  onPress={() => setForm((f) => ({ ...f, flavorId: fl.id }))}
                >
                  <Text style={[
                    styles.flavorPillText,
                    form.flavorId === fl.id && { color: palette.white },
                  ]}>
                    {fl.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={styles.fieldLabel}>Nombre de sachets</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={form.bagCount}
            onChangeText={(v) => setForm((f) => ({ ...f, bagCount: v }))}
          />

          <Text style={styles.fieldLabel}>Prix (GNF)</Text>
          <MoneyInput
            style={styles.input}
            value={form.unitPrice}
            onChangeText={(v) => setForm((f) => ({ ...f, unitPrice: v }))}
          />
          {!!form.bagCount && !!form.unitPrice && (
            <Text style={styles.perBagCalc}>
              = {formatGNF(Math.round((parseInt(form.unitPrice) || 0) / (parseInt(form.bagCount) || 1)))} par sachet
            </Text>
          )}
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.ink },
  headerCount: { fontSize: 12, color: palette.muted, marginTop: 1 },
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.cautionSoft, padding: 12, margin: 16, borderRadius: 10,
    borderWidth: 1, borderColor: palette.caution + '40',
  },
  warningText: { fontSize: 13, color: palette.caution, flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  // One shared card wraps the whole list; rows are flat, divided by
  // rowDivider. The "layers" icon every row used to repeat regardless of
  // content carried no real information, so it's gone, not just restyled.
  listContent: {
    margin: 16, backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center' },
  card: { padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bulkName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  bulkMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.paper, borderRadius: 8, padding: 10 },
  priceLabel: { fontSize: 12, color: palette.muted },
  priceValue: { fontSize: 15, fontWeight: '700', color: palette.moss, flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  flavorPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line,
  },
  flavorPillActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  flavorPillText: { fontSize: 14, color: palette.ink, fontWeight: '500' },
  perBagCalc: { fontSize: 13, color: palette.moss, marginTop: 6, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
