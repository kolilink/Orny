import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getFlavors, addFlavor, updateFlavor, deleteFlavor, syncFlavorsFromSupabase } from '../../store/flavors';
import { ProductFlavor } from '../../types';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

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
        contentContainerStyle={styles.list}
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

      {/* Delete confirm modal */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: 12 }} />
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

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.ink },
  headerCount: { fontSize: 12, color: palette.muted, marginTop: 1 },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center' },
  card: {
    backgroundColor: palette.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: palette.line,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: palette.moss,
  },
  flavorLabel: { fontSize: 16, fontWeight: '600', color: palette.ink },
  flavorMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: palette.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: palette.ink, marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
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
