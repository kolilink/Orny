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
import { formatDate } from '../../utils/format';

const C = {
  primary: '#1D9E75',
  red: '#E24B4A',
  orange: '#EF9F27',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
};

type StockStatus = 'CRITIQUE' | 'FAIBLE' | 'OK';

const getStatus = (item: StockItem): StockStatus => {
  if (item.currentLevel < item.alertThreshold) return 'CRITIQUE';
  if (item.currentLevel < item.alertThreshold * 1.2) return 'FAIBLE';
  return 'OK';
};

const STATUS_COLORS: Record<StockStatus, { bg: string; text: string }> = {
  CRITIQUE: { bg: '#FDECEA', text: C.red },
  FAIBLE: { bg: '#FEF4E4', text: C.orange },
  OK: { bg: '#E8F6F0', text: C.primary },
};

type NewItemForm = { name: string; unit: string; currentLevel: string; alertThreshold: string };
const EMPTY_ITEM: NewItemForm = { name: '', unit: '', currentLevel: '0', alertThreshold: '0' };

export default function StockScreen() {
  const insets = useSafeAreaInsets();
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
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {criticalItems.length > 0 && (
          <View style={styles.alertBanner}>
            <Text style={styles.alertText}>
              ⚠ {criticalItems.length} article{criticalItems.length > 1 ? 's' : ''} en stock critique
            </Text>
          </View>
        )}

        {stock.map((item) => {
          const status = getStatus(item);
          const colors = STATUS_COLORS[status];
          return (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.itemName}>{item.name}</Text>
                <View style={styles.cardHeaderRight}>
                  <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.badgeText, { color: colors.text }]}>{status}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteItem(item)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={16} color={C.muted} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.levelText}>
                <Text style={styles.levelNum}>{item.currentLevel}</Text>
                {' '}{item.unit}
              </Text>
              <Text style={styles.thresholdText}>
                Seuil d'alerte : {item.alertThreshold} {item.unit}
              </Text>
              <Text style={styles.updatedText}>
                Mis à jour le {formatDate(item.lastUpdated.split('T')[0])}
              </Text>
            </View>
          );
        })}

        {stock.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="cube-outline" size={48} color={C.muted} />
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
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border,
  },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  addBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  alertBanner: { backgroundColor: C.red, borderRadius: 10, padding: 12 },
  alertText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    gap: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { fontSize: 16, fontWeight: '600', color: C.text, flex: 1 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  deleteBtn: { padding: 4 },
  levelText: { fontSize: 28, fontWeight: '500', color: C.text, marginTop: 4 },
  levelNum: { fontWeight: '700' },
  thresholdText: { fontSize: 12, color: C.muted },
  updatedText: { fontSize: 11, color: '#BABAB6' },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.muted },
  emptyHint: { fontSize: 13, color: C.muted },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: C.bg,
    borderTopWidth: 1, borderColor: C.border,
  },
  updateBtn: {
    backgroundColor: C.primary, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  updateBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  editRow: { marginBottom: 14 },
  editLabel: { fontSize: 14, color: C.muted, marginBottom: 6 },
  editInput: {
    backgroundColor: C.bg, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, padding: 12, fontSize: 16, color: C.text,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, color: C.muted, fontWeight: '600' },
  confirmBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 16, color: '#FFFFFF', fontWeight: '700' },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24,
  },
  confirmBox: { backgroundColor: C.card, borderRadius: 16, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  confirmSub: { fontSize: 14, color: C.muted, textAlign: 'center', marginBottom: 20 },
  confirmDeleteBtn: {
    backgroundColor: C.red, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  confirmDeleteText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  confirmCancelBtn: {
    borderRadius: 12, height: 52, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmCancelText: { fontSize: 16, color: C.muted, fontWeight: '600' },
});
