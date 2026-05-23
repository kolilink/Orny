import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getFlavors, addFlavor, updateFlavor, deleteFlavor, syncFlavorsFromSupabase } from '../../store/flavors';
import { ProductFlavor } from '../../types';
import { formatGNF } from '../../utils/format';

const C = {
  primary: '#1D9E75',
  red: '#E24B4A',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
};

type FormState = { label: string; weightG: string; defaultPrice: string };
const EMPTY_FORM: FormState = { label: '', weightG: '80', defaultPrice: '15000' };

export default function FlavorsScreen() {
  const insets = useSafeAreaInsets();
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProductFlavor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductFlavor | null>(null);

  const load = useCallback(async () => {
    await syncFlavorsFromSupabase();
    const data = await getFlavors();
    setFlavorsState(data);
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
        await addFlavor({ label: form.label.trim(), weightG, defaultPrice });
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Saveurs / Produits</Text>
          <Text style={styles.subtitle}>{flavors.length} saveur{flavors.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={flavors}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="color-palette-outline" size={48} color={C.muted} />
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
                <Ionicons name="pencil-outline" size={18} color={C.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item)}>
                <Ionicons name="trash-outline" size={18} color={C.red} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Delete confirm modal */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer cette saveur ?</Text>
            <Text style={styles.confirmSub}>
              {deleteTarget ? `"${deleteTarget.label}" sera supprimée. Les ventes existantes ne seront pas affectées.` : ''}
            </Text>
            <TouchableOpacity
              style={styles.confirmDeleteBtn}
              onPress={async () => {
                if (!deleteTarget) return;
                await deleteFlavor(deleteTarget.id);
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

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {editing ? 'Modifier la saveur' : 'Nouvelle saveur'}
              </Text>
              <ScrollView>
                <Text style={styles.fieldLabel}>Nom de la saveur *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Nature, Piment, Barbecue…"
                  value={form.label}
                  onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
                  autoFocus
                />
                <Text style={styles.fieldLabel}>Poids unitaire (g)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="80"
                  keyboardType="decimal-pad"
                  value={form.weightG}
                  onChangeText={(v) => setForm((f) => ({ ...f, weightG: v }))}
                />
                <Text style={styles.fieldLabel}>Prix par défaut (GNF)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="15000"
                  keyboardType="numeric"
                  value={form.defaultPrice}
                  onChangeText={(v) => setForm((f) => ({ ...f, defaultPrice: v }))}
                />
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  <Text style={styles.confirmText}>{saving ? '…' : 'Enregistrer'}</Text>
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
  subtitle: { fontSize: 13, color: C.muted, marginTop: 2 },
  addBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.muted },
  emptyHint: { fontSize: 13, color: C.muted, textAlign: 'center' },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary,
  },
  flavorLabel: { fontSize: 16, fontWeight: '600', color: C.text },
  flavorMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 14, fontSize: 16, color: C.text,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
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
