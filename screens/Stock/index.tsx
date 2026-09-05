import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getStock, updateStock, addStockItem, deleteStockItem } from '../../store/stock';
import { StockItem } from '../../types';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type StockStatus = 'CRITIQUE' | 'FAIBLE' | 'OK';

const getStatus = (item: StockItem): StockStatus => {
  if (item.currentLevel < item.alertThreshold) return 'CRITIQUE';
  if (item.currentLevel < item.alertThreshold * 1.2) return 'FAIBLE';
  return 'OK';
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
  const [stock, setStockState] = useState<StockItem[]>([]);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newItemForm, setNewItemForm] = useState<NewItemForm>(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StockItem | null>(null);

  const load = useCallback(async () => {
    const s = await getStock();
    setStockState(s);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      setStockState(updated);
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
    console.log('[Stock] delete pressed for', item.id, item.name);
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

      <View style={styles.footer}>
        <TouchableOpacity style={styles.updateBtn} onPress={openUpdateModal}>
          <Text style={styles.updateBtnText}>Mettre à jour les niveaux</Text>
        </TouchableOpacity>
      </View>

      {/* Update levels modal */}
      <Modal visible={showUpdateModal} animationType="slide" transparent onRequestClose={() => setShowUpdateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mettre à jour le stock</Text>
            <ScrollView style={{ maxHeight: 400 }}>
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
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowUpdateModal(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, saving && { opacity: 0.6 }]}
                onPress={handleUpdate}
                disabled={saving}
              >
                <Text style={styles.confirmText}>{saving ? 'Enregistrement…' : 'Confirmer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete confirm modal */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer cet article ?</Text>
            <Text style={styles.confirmSub}>
              {deleteTarget ? `Supprimer "${deleteTarget.name}" du stock ?` : ''}
            </Text>
            <TouchableOpacity
              style={styles.confirmDeleteBtn}
              onPress={async () => {
                if (!deleteTarget) return;
                await deleteStockItem(deleteTarget.id);
                await load();
                setDeleteTarget(null);
              }}
            >
              <Text style={styles.confirmDeleteText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setDeleteTarget(null)}>
              <Text style={styles.confirmCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add new item modal */}
      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Nouvel article de stock</Text>
              <ScrollView>
                <Text style={styles.editLabel}>Nom de l'article *</Text>
                <TextInput
                  style={styles.editInput}
                  placeholder="Ex: Shampoo, Sel, Emballages…"
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
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, saving && { opacity: 0.6 }]}
                  onPress={handleAddItem}
                  disabled={saving}
                >
                  <Text style={styles.confirmText}>{saving ? '…' : 'Ajouter'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24,
  },
  confirmBox: { backgroundColor: palette.card, borderRadius: 16, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, textAlign: 'center', marginBottom: 6 },
  confirmSub: { fontSize: 14, color: palette.muted, textAlign: 'center', marginBottom: 20 },
  confirmDeleteBtn: {
    backgroundColor: palette.critical, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  confirmDeleteText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  confirmCancelBtn: {
    borderRadius: 12, height: 52, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmCancelText: { fontSize: 16, color: palette.muted, fontWeight: '600' },
});
