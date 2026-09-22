import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getFlavors, addFlavor, updateFlavor, deleteFlavor, syncFlavorsFromSupabase } from '../../store/flavors';
import { ProductFlavor } from '../../types';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, Text } from '../../components/ui';

type FormState = { label: string; weightG: string; defaultPrice: string };
const EMPTY_FORM: FormState = { label: '', weightG: '80', defaultPrice: '15000' };

export default function FlavorsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation();
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProductFlavor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductFlavor | null>(null);

  // Cache-first: render instantly from cache, then sync and re-render.
  const load = useCallback(async () => {
    setFlavorsState(await getFlavors());
    await syncFlavorsFromSupabase();
    setFlavorsState(await getFlavors());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (f: ProductFlavor) => {
    setEditing(f);
    setForm({ label: f.label, weightG: String(f.weightG), defaultPrice: String(f.defaultPrice) });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) {
      Alert.alert('Erreur', 'Le nom de la saveur est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const weightG = parseFloat(form.weightG) || 80;
      const defaultPrice = parseInt(form.defaultPrice) || 0;
      if (editing) {
        await updateFlavor(editing.id, { label: form.label.trim(), weightG, defaultPrice });
      } else {
        await addFlavor({ label: form.label.trim(), weightG, defaultPrice, recipePerUnit: [] });
      }
      await load();
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (f: ProductFlavor) => {
    setDeleteTarget(f);
  };

  // Title + count and the "+" both live in the native header (this screen
  // has one — see the rule in navigation/index.tsx), not duplicated below.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Saveurs</Text>
          <Text style={styles.headerCount}>{flavors.length} saveur{flavors.length !== 1 ? 's' : ''}</Text>
        </View>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={openAdd} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, flavors.length, palette.moss]);

  return (
    <View style={styles.container}>

      <FlatList
        data={flavors}
        keyExtractor={(item) => item.id}
        contentContainerStyle={flavors.length > 0 ? styles.listContent : styles.list}
        ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="color-palette-outline" size={48} color={palette.muted} />
            <Text style={styles.emptyText}>Aucune saveur définie</Text>
            <Text style={styles.emptyHint}>Appuyez sur + pour créer une saveur</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardLeft}>
              <View style={styles.colorDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.flavorLabel}>{item.label}</Text>
                <Text style={styles.flavorMeta}>{item.weightG}g · {formatGNF(item.defaultPrice)}</Text>
              </View>
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
        )}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteFlavor(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer cette saveur ?"
        message={deleteTarget ? `"${deleteTarget.label}" sera supprimée. Les ventes existantes ne seront pas affectées.` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Add / Edit */}
      <AppModal visible={showModal} onClose={() => setShowModal(false)} title={editing ? 'Modifier la saveur' : 'Nouvelle saveur'}>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom de la saveur *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Nature, Piment"
            placeholderTextColor={palette.muted}
            value={form.label}
            onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
            autoFocus
          />
          <Text style={styles.fieldLabel}>Poids unitaire (g)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={form.weightG}
            onChangeText={(v) => setForm((f) => ({ ...f, weightG: v }))}
          />
          <Text style={styles.fieldLabel}>Prix par défaut (GNF)</Text>
          <MoneyInput
            style={styles.input}
            value={form.defaultPrice}
            onChangeText={(v) => setForm((f) => ({ ...f, defaultPrice: v }))}
          />
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
  list: { padding: 16, paddingBottom: 40 },
  // One shared card wraps the whole list; rows are flat, divided by
  // rowDivider — not individually bordered/shadowed.
  listContent: {
    margin: 16, backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: palette.moss,
  },
  flavorLabel: { fontSize: 16, fontWeight: '600', color: palette.ink },
  flavorMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
