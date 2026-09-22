import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getStock, updateStock, addStockItem, deleteStockItem, syncStockFromSupabase } from '../../store/stock';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, syncBulksFromSupabase } from '../../store/bulks';
import { getProducts } from '../../store/products';
import { StockItem } from '../../types';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, Text } from '../../components/ui';
import { stockSeverity } from '../../utils/stockAlerts';

type StockStatus = 'CRITIQUE' | 'FAIBLE' | 'OK';

// Same rule Ventes/notifications/the Coach data feed already use — see
// utils/stockAlerts.ts for why this screen used to disagree with all three.
const getStatus = (item: StockItem): StockStatus => {
  const severity = stockSeverity(item.currentLevel, item.alertThreshold);
  return severity === 'critical' ? 'CRITIQUE' : severity === 'low' ? 'FAIBLE' : 'OK';
};

const makeStatusColors = (palette: Palette): Record<StockStatus, { bg: string; text: string }> => ({
  CRITIQUE: { bg: palette.criticalSoft, text: palette.critical },
  FAIBLE: { bg: palette.cautionSoft, text: palette.caution },
  OK: { bg: palette.mossSoft, text: palette.moss },
});

type NewItemForm = { name: string; unit: string; currentLevel: string; alertThreshold: string };
const EMPTY_ITEM: NewItemForm = { name: '', unit: '', currentLevel: '0', alertThreshold: '0' };

export default function StockScreen() {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const STATUS_COLORS = makeStatusColors(palette);
  const [allStock, setAllStockState] = useState<StockItem[]>([]);
  const [finishedGoodsIds, setFinishedGoodsIds] = useState<Set<string>>(new Set());
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newItemForm, setNewItemForm] = useState<NewItemForm>(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StockItem | null>(null);

  // This screen is raw materials only (sel, gaz, pommes de terre, huile,
  // emballages...) — finished-goods stock is a proxy row sharing its id
  // with a Saveur/Lot/Produit de production, and its only real home is the
  // Ventes screen now (see "en stock" on each product card there). Showing
  // it here too was pure repetition of the same number in two places.
  // Cache-first: read cache instantly, then sync in the background and
  // re-render with fresh data — this screen used to only ever read cache
  // with nothing refreshing it. `getProducts` isn't re-synced here: that
  // store is dead (superseded when Production and Ventes were unified onto
  // flavors/bulks) and nothing writes to it anymore.
  const load = useCallback(async () => {
    const [s, flavors, bulks, products] = await Promise.all([
      getStock(), getFlavors(), getBulks(), getProducts(),
    ]);
    setAllStockState(s);
    setFinishedGoodsIds(new Set([
      ...flavors.map((f) => f.id),
      ...bulks.map((b) => b.id),
      ...products.map((p) => p.id),
    ]));

    await Promise.all([syncStockFromSupabase(), syncFlavorsFromSupabase(), syncBulksFromSupabase()]);
    const [freshS, freshFlavors, freshBulks] = await Promise.all([getStock(), getFlavors(), getBulks()]);
    setAllStockState(freshS);
    setFinishedGoodsIds(new Set([
      ...freshFlavors.map((f) => f.id),
      ...freshBulks.map((b) => b.id),
      ...products.map((p) => p.id),
    ]));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stock = allStock.filter((item) => !finishedGoodsIds.has(item.id));
  const criticalItems = stock.filter((i) => getStatus(i) === 'CRITIQUE');

  const openUpdateModal = () => {
    const vals: Record<string, string> = {};
    stock.forEach((item) => { vals[item.id] = String(item.currentLevel); });
    setEditValues(vals);
    setShowUpdateModal(true);
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const updates: Record<string, number> = {};
      Object.entries(editValues).forEach(([key, val]) => {
        updates[key] = parseFloat(val) || 0;
      });
      const updated = await updateStock(updates);
      setAllStockState(updated);
      setShowUpdateModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!newItemForm.name.trim() || !newItemForm.unit.trim()) {
      Alert.alert('Erreur', 'Nom et unité sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      await addStockItem({
        name: newItemForm.name.trim(),
        unit: newItemForm.unit.trim(),
        currentLevel: parseFloat(newItemForm.currentLevel) || 0,
        alertThreshold: parseFloat(newItemForm.alertThreshold) || 0,
      });
      await load();
      setNewItemForm(EMPTY_ITEM);
      setShowAddModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = (item: StockItem) => {
    setDeleteTarget(item);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Stock</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color={palette.white} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {criticalItems.length > 0 && (
          <View style={styles.alertBanner}>
            <Ionicons name="alert-circle" size={16} color={palette.white} />
            <Text style={styles.alertText}>
              {criticalItems.length} article{criticalItems.length > 1 ? 's' : ''} en stock critique
            </Text>
          </View>
        )}

        {stock.length > 0 && (
          <View style={styles.list}>
            {stock.map((item, idx) => {
              const status = getStatus(item);
              const needsAttention = status !== 'OK';
              const colors = STATUS_COLORS[status];
              return (
                <View key={item.id} style={[styles.row, idx === stock.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.levelText}>
                        {item.currentLevel} <Text style={styles.levelUnit}>{item.unit}</Text>
                      </Text>
                    </View>
                    <Text style={[styles.caption, needsAttention && { color: colors.text, fontWeight: '700' }]}>
                      {needsAttention
                        ? (status === 'CRITIQUE' ? 'Stock critique' : 'Stock faible')
                        : `Seuil : ${item.alertThreshold} ${item.unit}`}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteItem(item)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={16} color={palette.muted} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {stock.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="cube-outline" size={48} color={palette.muted} />
            <Text style={styles.emptyText}>Aucun article en stock</Text>
            <Text style={styles.emptyHint}>Appuyez sur + pour ajouter un article</Text>
          </View>
        )}
      </ScrollView>

      {/* Nothing to update yet when there's no article at all — the empty
          state above already points at "+" as the real next action, so
          this footer would otherwise open onto a title with nothing behind
          it (no rows, nothing to type into) every time. */}
      {stock.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.updateBtn} onPress={openUpdateModal}>
            <Text style={styles.updateBtnText}>Mettre à jour les niveaux</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Update levels modal */}
      <AppModal visible={showUpdateModal} onClose={() => setShowUpdateModal(false)} title="Mettre à jour le stock">
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 400, flexShrink: 1 }}>
          {stock.map((item) => (
            <View key={item.id} style={styles.editRow}>
              <Text style={styles.editLabel}>{item.name} ({item.unit})</Text>
              <TextInput
                style={styles.editInput}
                keyboardType="decimal-pad"
                value={editValues[item.id] ?? ''}
                onChangeText={(t) => setEditValues((prev) => ({ ...prev, [item.id]: t }))}
              />
            </View>
          ))}
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowUpdateModal(false)} style={{ flex: 1 }} />
            <Button label="Confirmer" onPress={handleUpdate} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Delete confirm modal */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteStockItem(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer cet article ?"
        message={deleteTarget ? `Supprimer "${deleteTarget.name}" du stock ?` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Add new item modal */}
      <AppModal visible={showAddModal} onClose={() => setShowAddModal(false)} title="Nouvel article de stock">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.editLabel}>Nom de l'article *</Text>
          <TextInput
            style={styles.editInput}
            placeholder="Ex: Pommes de terre, Huile, Sachets d'emballage…"
            value={newItemForm.name}
            onChangeText={(v) => setNewItemForm((f) => ({ ...f, name: v }))}
            autoFocus
          />
          <Text style={styles.editLabel}>Unité *</Text>
          <TextInput
            style={styles.editInput}
            placeholder="Ex: kg, L, unités, cartons…"
            value={newItemForm.unit}
            onChangeText={(v) => setNewItemForm((f) => ({ ...f, unit: v }))}
          />
          <Text style={styles.editLabel}>Niveau actuel</Text>
          <TextInput
            style={styles.editInput}
            keyboardType="decimal-pad"
            value={newItemForm.currentLevel}
            onChangeText={(v) => setNewItemForm((f) => ({ ...f, currentLevel: v }))}
          />
          <Text style={styles.editLabel}>Seuil d'alerte</Text>
          <TextInput
            style={styles.editInput}
            keyboardType="decimal-pad"
            value={newItemForm.alertThreshold}
            onChangeText={(v) => setNewItemForm((f) => ({ ...f, alertThreshold: v }))}
          />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowAddModal(false)} style={{ flex: 1 }} />
            <Button label="Ajouter" onPress={handleAddItem} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: palette.card, borderBottomWidth: 1, borderColor: palette.line,
  },
  title: { fontSize: 22, fontWeight: '700', color: palette.ink },
  addBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.critical, borderRadius: 10, padding: 12,
  },
  alertText: { color: palette.white, fontWeight: '600', fontSize: 14, flex: 1 },
  // One quiet list container with hairline dividers, not a separately
  // shadowed card per item — a shelf of ten items doesn't need ten cards
  // shouting for attention, only the ones that actually need it (see
  // `needsAttention` above, which is the only thing that still gets color).
  list: {
    backgroundColor: palette.card, borderRadius: 12, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderColor: palette.line,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  itemName: { fontSize: 15, fontWeight: '600', color: palette.ink, flex: 1 },
  deleteBtn: { padding: 4 },
  levelText: { fontSize: 16, fontWeight: '700', color: palette.ink },
  levelUnit: { fontSize: 12, fontWeight: '500', color: palette.muted },
  caption: { fontSize: 12.5, color: palette.muted, marginTop: 2 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: palette.paper,
    borderTopWidth: 1, borderColor: palette.line,
  },
  updateBtn: {
    backgroundColor: palette.moss, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  updateBtnText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: palette.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: palette.ink, marginBottom: 16 },
  editRow: { marginBottom: 14 },
  editLabel: { fontSize: 14, color: palette.muted, marginBottom: 6 },
  editInput: {
    backgroundColor: palette.paper, borderRadius: 10, borderWidth: 1,
    borderColor: palette.line, padding: 12, fontSize: 16, color: palette.ink,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: palette.paper,
    borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, color: palette.muted, fontWeight: '600' },
  confirmBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: palette.moss,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 16, color: palette.white, fontWeight: '700' },
});
