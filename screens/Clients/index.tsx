import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getClients, upsertClient, updateClient, deleteClient } from '../../store/clients';
import { getSales } from '../../store/sales';
import { Client, Sale, saleDebt } from '../../types';
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

type FormState = { name: string; phone: string; type: string; location: string };
const EMPTY_FORM: FormState = { name: '', phone: '', type: '', location: '' };

type ClientDebt = { client: string; total: number; sales: Sale[] };

export default function ClientsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'clients' | 'creances'>('clients');
  const [clients, setClientsState] = useState<Client[]>([]);
  const [debts, setDebtsState] = useState<ClientDebt[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, sales] = await Promise.all([getClients(), getSales()]);
    setClientsState(c);

    const debtMap = new Map<string, { total: number; sales: Sale[] }>();
    for (const sale of sales) {
      const debt = saleDebt(sale);
      if (debt > 0) {
        const existing = debtMap.get(sale.clientName) ?? { total: 0, sales: [] };
        debtMap.set(sale.clientName, {
          total: existing.total + debt,
          sales: [...existing.sales, sale],
        });
      }
    }
    const debtList: ClientDebt[] = Array.from(debtMap.entries())
      .map(([client, data]) => ({ client, total: data.total, sales: data.sales }))
      .sort((a, b) => b.total - a.total);
    setDebtsState(debtList);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalDebt = debts.reduce((sum, d) => sum + d.total, 0);

  const openAdd = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      phone: client.phone ?? '',
      type: client.type ?? '',
      location: client.location ?? '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Erreur', 'Le nom est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      if (editingClient) {
        await updateClient(editingClient.id, {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          type: form.type.trim() || undefined,
          location: form.location.trim() || undefined,
        });
      } else {
        await upsertClient(
          form.name.trim(),
          form.location.trim() || undefined,
          form.type.trim() || undefined,
          form.phone.trim() || undefined,
        );
      }
      await load();
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (client: Client) => {
    Alert.alert(
      'Supprimer',
      `Supprimer "${client.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteClient(client.id);
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
          <Text style={styles.title}>Clients</Text>
          <Text style={styles.count}>{clients.length} client{clients.length !== 1 ? 's' : ''}</Text>
        </View>
        {tab === 'clients' && (
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'clients' && styles.tabBtnActive]}
          onPress={() => setTab('clients')}
        >
          <Text style={[styles.tabText, tab === 'clients' && styles.tabTextActive]}>
            Clients
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'creances' && styles.tabBtnActive]}
          onPress={() => setTab('creances')}
        >
          <Text style={[styles.tabText, tab === 'creances' && styles.tabTextActive]}>
            Créances {debts.length > 0 ? `(${debts.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'clients' ? (
        <FlatList
          data={clients}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={48} color={C.muted} />
              <Text style={styles.emptyText}>Aucun client enregistré</Text>
              <Text style={styles.emptyHint}>Appuyez sur + pour ajouter votre premier client</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{item.name}</Text>
                  {!!item.type && <Text style={styles.clientMeta}>{item.type}</Text>}
                  {!!item.phone && (
                    <View style={styles.infoRow}>
                      <Ionicons name="call-outline" size={13} color={C.muted} />
                      <Text style={styles.infoText}>{item.phone}</Text>
                    </View>
                  )}
                  {!!item.location && (
                    <View style={styles.infoRow}>
                      <Ionicons name="location-outline" size={13} color={C.muted} />
                      <Text style={styles.infoText}>{item.location}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.cardActions}>
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
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {debts.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={48} color={C.primary} />
              <Text style={styles.emptyText}>Aucune créance en cours</Text>
              <Text style={styles.emptyHint}>Tous vos clients sont à jour</Text>
            </View>
          ) : (
            <>
              <View style={styles.debtSummary}>
                <Text style={styles.debtSummaryLabel}>Total dû</Text>
                <Text style={styles.debtSummaryValue}>{formatGNF(totalDebt)}</Text>
              </View>
              {debts.map((d) => (
                <View key={d.client} style={styles.debtCard}>
                  <View style={styles.debtTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{d.client.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientName}>{d.client}</Text>
                      <Text style={styles.clientMeta}>
                        {d.sales.length} vente{d.sales.length > 1 ? 's' : ''} à crédit non réglées
                      </Text>
                    </View>
                    <Text style={styles.debtAmount}>{formatGNF(d.total)}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {editingClient ? 'Modifier le client' : 'Nouveau client'}
              </Text>
              <ScrollView>
                <Text style={styles.fieldLabel}>Nom *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nom du client"
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  autoFocus
                />
                <Text style={styles.fieldLabel}>Numéro de téléphone</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: 620 00 00 00"
                  keyboardType="phone-pad"
                  value={form.phone}
                  onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                />
                <Text style={styles.fieldLabel}>Type (boutique, marché…)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: boutique, revendeuse marché"
                  value={form.type}
                  onChangeText={(v) => setForm((f) => ({ ...f, type: v }))}
                />
                <Text style={styles.fieldLabel}>Localisation (optionnel)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Kaloum, Ratoma…"
                  value={form.location}
                  onChangeText={(v) => setForm((f) => ({ ...f, location: v }))}
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
  count: { fontSize: 13, color: C.muted, marginTop: 2 },
  addBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row', backgroundColor: C.card,
    borderBottomWidth: 1, borderColor: C.border,
  },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderColor: C.primary },
  tabText: { fontSize: 14, color: C.muted, fontWeight: '500' },
  tabTextActive: { color: C.primary, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.muted },
  emptyHint: { fontSize: 13, color: C.muted, textAlign: 'center' },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'flex-start',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#E8F6F0', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: C.primary },
  clientName: { fontSize: 16, fontWeight: '600', color: C.text },
  clientMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  infoText: { fontSize: 12, color: C.muted },
  cardActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  debtSummary: {
    backgroundColor: '#FDECEA', borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#F5B8B7',
  },
  debtSummaryLabel: { fontSize: 15, fontWeight: '600', color: C.red },
  debtSummaryValue: { fontSize: 18, fontWeight: '700', color: C.red },
  debtCard: {
    backgroundColor: C.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#F5B8B7',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  debtTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  debtAmount: { fontSize: 16, fontWeight: '700', color: C.red },
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
