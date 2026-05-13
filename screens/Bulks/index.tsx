import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getBulks, addBulk, updateBulk, deleteBulk } from '../../store/bulks';
import { getFlavors } from '../../store/flavors';
import { BulkProduct, ProductFlavor } from '../../types';
import { formatGNF } from '../../utils/format';

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

type FormState = { name: string; flavorId: string; bagCount: string; unitPrice: string };
const EMPTY_FORM: FormState = { name: '', flavorId: '', bagCount: '15', unitPrice: '' };

export default function BulksScreen() {
  const insets = useSafeAreaInsets();
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BulkProduct | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [b, f] = await Promise.all([getBulks(), getFlavors()]);
    setBulksState(b);
    setFlavorsState(f);
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
        });
      }
      await load();
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (b: BulkProduct) => {
    Alert.alert(
      'Supprimer ce vrac ?',
      `"${b.name}" sera supprimé.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteBulk(b.id);
            await load();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Vrac / Lots</Text>
          <Text style={styles.subtitle}>{bulks.length} lot{bulks.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {flavors.length === 0 && (
        <View style={styles.warningBanner}>
          <Ionicons name="information-circle-outline" size={16} color={C.orange} />
          <Text style={styles.warningText}>Créez d'abord des saveurs dans Menu &gt; Saveurs</Text>
        </View>
      )}

      <FlatList
        data={bulks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="layers-outline" size={48} color={C.muted} />
            <Text style={styles.emptyText}>Aucun lot défini</Text>
            <Text style={styles.emptyHint}>Créez un lot pour vendre en vrac</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.iconBox}>
                <Ionicons name="layers" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulkName}>{item.name}</Text>
                <Text style={styles.bulkMeta}>
                  {item.bagCount} sachets · {flavorLabel(item.flavorId)}
                </Text>
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
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Prix du lot</Text>
              <Text style={styles.priceValue}>{formatGNF(item.unitPrice)}</Text>
              <Text style={styles.perBagText}>
                ({formatGNF(Math.round(item.unitPrice / item.bagCount))}/sachet)
              </Text>
            </View>
          </View>
        )}
      />

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {editing ? 'Modifier le lot' : 'Nouveau lot'}
              </Text>
              <ScrollView>
                <Text style={styles.fieldLabel}>Nom du lot *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Vrac 15, Lot Standard, Vrac Boutique…"
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
                          form.flavorId === fl.id && { color: '#fff' },
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
                  placeholder="15"
                  keyboardType="numeric"
                  value={form.bagCount}
                  onChangeText={(v) => setForm((f) => ({ ...f, bagCount: v }))}
                />

                <Text style={styles.fieldLabel}>Prix du lot (GNF)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: 200000"
                  keyboardType="numeric"
                  value={form.unitPrice}
                  onChangeText={(v) => setForm((f) => ({ ...f, unitPrice: v }))}
                />
                {!!form.bagCount && !!form.unitPrice && (
                  <Text style={styles.perBagCalc}>
                    = {formatGNF(Math.round((parseInt(form.unitPrice) || 0) / (parseInt(form.bagCount) || 1)))} par sachet
                  </Text>
                )}
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
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF4E4', padding: 12, margin: 16, borderRadius: 10,
    borderWidth: 1, borderColor: '#F5D78E',
  },
  warningText: { fontSize: 13, color: C.orange, flex: 1 },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.muted },
  emptyHint: { fontSize: 13, color: C.muted, textAlign: 'center' },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: '#E8F6F0', alignItems: 'center', justifyContent: 'center',
  },
  bulkName: { fontSize: 16, fontWeight: '600', color: C.text },
  bulkMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bg, borderRadius: 8, padding: 10 },
  priceLabel: { fontSize: 12, color: C.muted },
  priceValue: { fontSize: 15, fontWeight: '700', color: C.primary, flex: 1 },
  perBagText: { fontSize: 12, color: C.muted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '90%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 14, fontSize: 16, color: C.text,
  },
  flavorPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  flavorPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  flavorPillText: { fontSize: 14, color: C.text, fontWeight: '500' },
  perBagCalc: { fontSize: 13, color: C.primary, marginTop: 6, fontWeight: '600' },
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
});
