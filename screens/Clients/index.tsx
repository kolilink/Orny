import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { getClients, upsertClient, updateClient, deleteClient, syncClientsFromSupabase } from '../../store/clients';
import { getSales, updateSale, syncSalesFromSupabase } from '../../store/sales';
import { Client, Sale, RootStackParamList, saleDebt } from '../../types';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, PhoneInput, Text } from '../../components/ui';

type ClientsNav = NativeStackNavigationProp<RootStackParamList>;

type FormState = { name: string; phone: string; type: string; location: string };
const EMPTY_FORM: FormState = { name: '', phone: '', type: '', location: '' };

// Ported from the standalone Créances screen (deleted — this tab is now the
// only place debt is managed) so "who owes what" comes with the real
// mark-paid/partial-payment actions, not just a read-only total.
type DebtorGroup = { name: string; totalDebt: number; sales: Array<{ sale: Sale; debt: number; days: number }> };

function daysOld(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Aging severity, three steps: current (moss), 7-30 days (caution), 30+ days
// (critical) — the one place in the app where two "alarm" tones legitimately
// need to stay distinguishable from each other, not collapsed to one.
function agingColor(days: number, palette: Palette): string {
  if (days > 30) return palette.critical;
  if (days > 7) return palette.caution;
  return palette.moss;
}

function agingLabel(days: number): string {
  if (days === 0) return 'Auj.';
  if (days === 1) return 'Hier';
  return `${days}j`;
}

export default function ClientsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation<ClientsNav>();
  const [tab, setTab] = useState<'clients' | 'creances'>('clients');
  const [clients, setClientsState] = useState<Client[]>([]);
  const [debtGroups, setDebtGroups] = useState<DebtorGroup[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [partialSale, setPartialSale] = useState<Sale | null>(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [markPaidTarget, setMarkPaidTarget] = useState<Sale | null>(null);

  // Cache-first: build the debtor list from cache immediately, then sync
  // and rebuild once fresh clients/sales land — this used to block on the
  // network sync before showing anything.
  const load = useCallback(async () => {
    let [c, sales] = await Promise.all([getClients(), getSales()]);
    setClientsState(c);
    buildDebtorGroups(sales);

    await Promise.all([syncClientsFromSupabase(), syncSalesFromSupabase()]);
    [c, sales] = await Promise.all([getClients(), getSales()]);
    setClientsState(c);
    buildDebtorGroups(sales);
  }, []);

  const buildDebtorGroups = (sales: Sale[]) => {
    const groupMap: Record<string, DebtorGroup> = {};
    for (const sale of sales) {
      const debt = saleDebt(sale);
      if (debt <= 0) continue;
      const days = daysOld(sale.date);
      if (!groupMap[sale.clientName]) groupMap[sale.clientName] = { name: sale.clientName, totalDebt: 0, sales: [] };
      groupMap[sale.clientName].totalDebt += debt;
      groupMap[sale.clientName].sales.push({ sale, debt, days });
    }
    setDebtGroups(Object.values(groupMap).sort((a, b) => b.totalDebt - a.totalDebt));
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalDebt = debtGroups.reduce((sum, g) => sum + g.totalDebt, 0);

  async function handleConfirmPartial() {
    if (!partialSale) return;
    const amount = parseInt(partialAmount.replace(/\s/g, ''), 10);
    if (!amount || amount <= 0) return Alert.alert('Erreur', 'Montant invalide.');
    const alreadyPaid = partialSale.amountPaid ?? 0;
    const newPaid = Math.min(alreadyPaid + amount, partialSale.totalAmount);
    await updateSale(partialSale.id, { amountPaid: newPaid });
    setPartialSale(null);
    setPartialAmount('');
    await load();
  }

  const openAdd = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  // Title + count and the "+" action both live in the native header (this
  // screen has one — see the rule in navigation/index.tsx), matching
  // Patron's own "Clients / N clients" header — not duplicated as a second
  // row below it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Clients</Text>
          <Text style={styles.headerCount}>{clients.length} client{clients.length !== 1 ? 's' : ''}</Text>
        </View>
      ),
      headerRight: () => tab === 'clients' ? (
        <TouchableOpacity onPress={openAdd} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ) : null,
    });
  }, [navigation, tab, clients.length, palette.moss]);

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
    } catch (e: any) {
      // A real (non-network) rejection used to be swallowed entirely inside
      // upsertClient/updateClient — the modal stayed open with no
      // explanation, which read as "the button doesn't work."
      Alert.alert('Erreur', `Impossible d'enregistrer le client. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (client: Client) => {
    setDeleteTarget(client);
  };

  return (
    <View style={styles.container}>

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
            Créances {debtGroups.length > 0 ? `(${debtGroups.length})` : ''}
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
              <Ionicons name="people-outline" size={48} color={palette.muted} />
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
                      <Ionicons name="call-outline" size={13} color={palette.muted} />
                      <Text style={styles.infoText}>{item.phone}</Text>
                    </View>
                  )}
                  {!!item.location && (
                    <View style={styles.infoRow}>
                      <Ionicons name="location-outline" size={13} color={palette.muted} />
                      <Text style={styles.infoText}>{item.location}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => navigation.navigate('CustomerOrders', { initialClientName: item.name })}
                >
                  <Ionicons name="add-circle-outline" size={18} color={palette.moss} />
                </TouchableOpacity>
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
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {debtGroups.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={48} color={palette.moss} />
              <Text style={styles.emptyText}>Aucune créance en cours</Text>
              <Text style={styles.emptyHint}>Tous vos clients sont à jour</Text>
            </View>
          ) : (
            <>
              <View style={styles.debtSummary}>
                <Text style={styles.debtSummaryLabel}>Total dû</Text>
                <Text style={styles.debtSummaryValue}>{formatGNF(totalDebt)}</Text>
              </View>
              <View style={styles.legend}>
                <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: palette.moss }]} /><Text style={styles.legendText}>{'< 7j'}</Text></View>
                <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: palette.caution }]} /><Text style={styles.legendText}>7–30j</Text></View>
                <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: palette.critical }]} /><Text style={styles.legendText}>{'>30j'}</Text></View>
              </View>
              {debtGroups.map((group) => {
                const isExpanded = expandedClient === group.name;
                const worstAge = Math.max(...group.sales.map((s) => s.days));
                const badgeColor = agingColor(worstAge, palette);
                return (
                  <View key={group.name} style={styles.debtCard}>
                    <TouchableOpacity
                      style={styles.debtTop}
                      onPress={() => setExpandedClient(isExpanded ? null : group.name)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.ageBadge, { backgroundColor: badgeColor + '22' }]}>
                        <Text style={[styles.ageBadgeText, { color: badgeColor }]}>{agingLabel(worstAge)}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.clientName}>{group.name}</Text>
                        <Text style={styles.clientMeta}>
                          {group.sales.length} vente{group.sales.length > 1 ? 's' : ''} à crédit non réglées
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.debtAmount}>{formatGNF(group.totalDebt)}</Text>
                        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} style={{ marginTop: 2 }} />
                      </View>
                    </TouchableOpacity>

                    {isExpanded && group.sales.map(({ sale, debt, days }) => (
                      <View key={sale.id} style={styles.saleRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.saleProduct}>{sale.product}</Text>
                          <Text style={styles.saleMeta}>{sale.date}  ·  Total : {formatGNF(sale.totalAmount)}</Text>
                          {(sale.amountPaid ?? 0) > 0 && (
                            <Text style={styles.salePaid}>Déjà payé : {formatGNF(sale.amountPaid ?? 0)}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <Text style={[styles.debtBadge, { color: agingColor(days, palette) }]}>{formatGNF(debt)}</Text>
                          <TouchableOpacity style={styles.paidBtn} onPress={() => setMarkPaidTarget(sale)}>
                            <Text style={styles.paidBtnText}>Payé ✓</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.partialBtn} onPress={() => { setPartialSale(sale); setPartialAmount(''); }}>
                            <Text style={styles.partialBtnText}>Partiel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteClient(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer ce client ?"
        message={deleteTarget ? `Supprimer "${deleteTarget.name}" ?` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      <AppModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        title={editingClient ? 'Modifier le client' : 'Nouveau client'}
      >
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom *</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du client"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            autoFocus
          />
          <PhoneInput
            label="Téléphone"
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
          <Text style={styles.fieldLabel}>Adresse (optionnel)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Kaloum, Ratoma…"
            value={form.location}
            onChangeText={(v) => setForm((f) => ({ ...f, location: v }))}
          />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Mark paid confirm */}
      <ConfirmDialog
        visible={!!markPaidTarget}
        onClose={() => setMarkPaidTarget(null)}
        onConfirm={async () => {
          if (!markPaidTarget) return;
          await updateSale(markPaidTarget.id, { amountPaid: markPaidTarget.totalAmount });
          await load();
          setMarkPaidTarget(null);
        }}
        title="Marquer comme payé ?"
        message={markPaidTarget ? `${markPaidTarget.clientName} — ${formatGNF(saleDebt(markPaidTarget))}` : ''}
        confirmLabel="Payé ✓"
        icon="checkmark-circle-outline"
      />

      {/* Partial payment */}
      <AppModal visible={!!partialSale} onClose={() => setPartialSale(null)} title="Paiement partiel">
        {partialSale && (
          <>
            <Text style={styles.sheetSub}>{partialSale.clientName} — Reste à payer : {formatGNF(saleDebt(partialSale))}</Text>
            <Text style={styles.fieldLabel}>Montant reçu (GNF)</Text>
            <MoneyInput
              style={styles.input}
              value={partialAmount}
              onChangeText={setPartialAmount}
              placeholder="Ex: 50 000"
              autoFocus
            />
            <Button label="Confirmer" onPress={handleConfirmPartial} fullWidth style={{ marginTop: 16 }} />
          </>
        )}
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.ink },
  headerCount: { fontSize: 12, color: palette.muted, marginTop: 1 },
  tabRow: {
    flexDirection: 'row', backgroundColor: palette.card,
    borderBottomWidth: 1, borderColor: palette.line,
  },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderColor: palette.moss },
  tabText: { fontSize: 14, color: palette.muted, fontWeight: '500' },
  tabTextActive: { color: palette.moss, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center' },
  card: {
    backgroundColor: palette.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: palette.line,
    flexDirection: 'row', alignItems: 'flex-start',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: palette.moss },
  clientName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  clientMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  infoText: { fontSize: 12, color: palette.muted },
  cardActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  debtSummary: {
    backgroundColor: palette.criticalSoft, borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: palette.critical + '40',
  },
  debtSummaryLabel: { fontSize: 15, fontWeight: '600', color: palette.critical },
  debtSummaryValue: { fontSize: 18, fontWeight: '700', color: palette.critical },
  debtCard: {
    backgroundColor: palette.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: palette.critical + '40',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  debtTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  debtAmount: { fontSize: 16, fontWeight: '700', color: palette.critical },
  legend: { flexDirection: 'row', gap: 16, marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: palette.muted },
  ageBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 46, alignItems: 'center' },
  ageBadgeText: { fontSize: 13, fontWeight: '700' },
  saleRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, marginTop: 10, borderTopWidth: 1, borderColor: palette.line },
  saleProduct: { fontSize: 14, fontWeight: '600', color: palette.ink },
  saleMeta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  salePaid: { fontSize: 12, color: palette.moss, marginTop: 2 },
  debtBadge: { fontSize: 15, fontWeight: '700' },
  paidBtn: { backgroundColor: palette.mossSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  paidBtnText: { fontSize: 13, color: palette.moss, fontWeight: '700' },
  partialBtn: { backgroundColor: palette.cautionSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  partialBtnText: { fontSize: 13, color: palette.caution, fontWeight: '700' },
  sheetSub: { fontSize: 14, color: palette.muted, marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
