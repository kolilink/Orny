import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, TextInput, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Supplier, Purchase, RootStackParamList, purchaseDebt } from '../../types';
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, syncSuppliersFromSupabase } from '../../store/suppliers';
import { getPurchases, deletePurchase, recordPurchasePayment, syncPurchasesFromSupabase } from '../../store/purchases';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, PhoneInput, Text } from '../../components/ui';
import MonthGroup from './MonthGroup';
import PurchaseFormModal from './PurchaseFormModal';

type SuppliersNav = NativeStackNavigationProp<RootStackParamList>;

export default function SuppliersScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation<SuppliersNav>();
  const [tab, setTab] = useState<'suppliers' | 'purchases'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  // ── Supplier form modal ────────────────────────────────────────
  const [supplierModal, setSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sProduct, setSProduct] = useState('');
  const [sNotes, setSNotes] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);

  // ── Delete / payment confirms ───────────────────────────────────
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState<Supplier | null>(null);
  const [deletePurchaseTarget, setDeletePurchaseTarget] = useState<Purchase | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<Purchase | null>(null);
  const [partialTarget, setPartialTarget] = useState<Purchase | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const [purchaseModal, setPurchaseModal] = useState(false);

  // Cache-first: render instantly from cache, then sync and re-render
  // once fresh data lands — the two syncs used to fire without being
  // awaited, so nothing ever re-rendered once they actually resolved.
  const load = useCallback(async () => {
    const [s, p] = await Promise.all([getSuppliers(), getPurchases()]);
    setSuppliers(s);
    setPurchases(p);

    await Promise.all([syncSuppliersFromSupabase(), syncPurchasesFromSupabase()]);
    const [freshS, freshP] = await Promise.all([getSuppliers(), getPurchases()]);
    setSuppliers(freshS);
    setPurchases(freshP);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openAddSupplier() {
    setEditingSupplier(null);
    setSName(''); setSPhone(''); setSProduct(''); setSNotes('');
    setSupplierModal(true);
  }

  async function handleSaveSupplier() {
    if (!sName.trim()) return;
    if (!sProduct.trim()) return;
    setSavingSupplier(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, {
          name: sName.trim(), phone: sPhone.trim() || undefined,
          product: sProduct.trim(), notes: sNotes.trim() || undefined,
        });
      } else {
        await addSupplier({ name: sName.trim(), phone: sPhone.trim() || undefined, product: sProduct.trim(), notes: sNotes.trim() || undefined });
      }
      setSupplierModal(false);
      const data = await getSuppliers();
      setSuppliers(data);
    } finally {
      setSavingSupplier(false);
    }
  }

  async function confirmDeleteSupplier() {
    if (!deleteSupplierTarget) return;
    await deleteSupplier(deleteSupplierTarget.id);
    setSuppliers((p) => p.filter((s) => s.id !== deleteSupplierTarget.id));
    setDeleteSupplierTarget(null);
  }

  async function handleConfirmPartial() {
    if (!partialTarget) return;
    const amount = parseInt(partialAmount.replace(/\s/g, ''), 10);
    if (!amount || amount <= 0) return;
    const alreadyPaid = partialTarget.amountPaid ?? 0;
    const newPaid = Math.min(alreadyPaid + amount, partialTarget.totalAmount);
    await recordPurchasePayment(partialTarget.id, newPaid);
    setPartialTarget(null);
    setPartialAmount('');
    const data = await getPurchases();
    setPurchases(data);
  }

  const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
  const totalOwed = purchases.reduce((sum, p) => sum + purchaseDebt(p), 0);

  // "+" lives in the native header (this screen has one — see the rule in
  // navigation/index.tsx), not duplicated as its own row below it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => tab === 'suppliers' ? openAddSupplier() : setPurchaseModal(true)} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, tab, palette.moss]);

  return (
    <View style={styles.container}>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'suppliers' && styles.tabActive]} onPress={() => setTab('suppliers')}>
          <Text style={[styles.tabText, tab === 'suppliers' && styles.tabTextActive]}>Fournisseurs ({suppliers.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'purchases' && styles.tabActive]} onPress={() => setTab('purchases')}>
          <Text style={[styles.tabText, tab === 'purchases' && styles.tabTextActive]}>Achats ({purchases.length})</Text>
        </TouchableOpacity>
      </View>

      {tab === 'suppliers' ? (
        <FlatList
          data={suppliers}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<Text style={styles.empty}>Aucun fournisseur enregistré{'\n'}Appuyez sur + pour en ajouter un</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('SupplierDetail', { supplierId: item.id })}
            >
              <View style={styles.cardLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardSub}>{item.phone || item.product}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.muted} />
            </TouchableOpacity>
          )}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {purchases.length > 0 && (
            <View style={{ gap: 8, marginBottom: 16 }}>
              <View style={[styles.totalRow, { marginBottom: 0 }]}>
                <Text style={styles.totalLabel}>Total achats</Text>
                <Text style={styles.totalValue}>{formatGNF(totalPurchases)}</Text>
              </View>
              {totalOwed > 0 && (
                <View style={[styles.totalRow, { marginBottom: 0, backgroundColor: palette.criticalSoft }]}>
                  <Text style={[styles.totalLabel, styles.totalLabelDue]}>Dû aux fournisseurs</Text>
                  <Text style={[styles.totalValue, styles.totalLabelDue]}>{formatGNF(totalOwed)}</Text>
                </View>
              )}
            </View>
          )}
          {purchases.length === 0 ? (
            <Text style={styles.empty}>Aucun achat enregistré{'\n'}Appuyez sur + pour en ajouter un</Text>
          ) : (
            <MonthGroup
              purchases={purchases}
              onMarkPaid={setMarkPaidTarget}
              onPartial={(target) => { setPartialTarget(target); setPartialAmount(''); }}
              onDelete={setDeletePurchaseTarget}
            />
          )}
        </ScrollView>
      )}

      {/* Add / Edit Supplier Modal */}
      <AppModal
        visible={supplierModal}
        onClose={() => setSupplierModal(false)}
        title={editingSupplier ? 'Modifier fournisseur' : 'Nouveau fournisseur'}
      >
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom *</Text>
          <TextInput style={styles.input} value={sName} onChangeText={setSName} placeholder="Nom du fournisseur" placeholderTextColor={palette.muted} autoFocus />
          <Text style={styles.fieldLabel}>Produit fourni *</Text>
          <TextInput style={styles.input} value={sProduct} onChangeText={setSProduct} placeholder="Ex: Farine, ciment" placeholderTextColor={palette.muted} />
          <PhoneInput label="Téléphone" value={sPhone} onChangeText={setSPhone} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={styles.input} value={sNotes} onChangeText={setSNotes} placeholderTextColor={palette.muted} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setSupplierModal(false)} style={{ flex: 1 }} />
            <Button label={editingSupplier ? 'Mettre à jour' : 'Ajouter'} onPress={handleSaveSupplier} loading={savingSupplier} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* New purchase (free — not scoped to any one supplier) */}
      <PurchaseFormModal
        visible={purchaseModal}
        onClose={() => setPurchaseModal(false)}
        onSaved={load}
      />

      {/* Partial payment on a purchase */}
      <AppModal visible={!!partialTarget} onClose={() => setPartialTarget(null)} title="Paiement partiel">
        {partialTarget && (
          <>
            <Text style={styles.sheetSub}>{partialTarget.supplierName} — Reste à payer : {formatGNF(purchaseDebt(partialTarget))}</Text>
            <Text style={styles.fieldLabel}>Montant versé (GNF)</Text>
            <MoneyInput
              style={styles.input}
              value={partialAmount}
              onChangeText={setPartialAmount}
              autoFocus
            />
            <Button label="Confirmer" onPress={handleConfirmPartial} fullWidth style={{ marginTop: 16 }} />
          </>
        )}
      </AppModal>

      {/* Delete Supplier Confirm */}
      <ConfirmDialog
        visible={!!deleteSupplierTarget}
        onClose={() => setDeleteSupplierTarget(null)}
        onConfirm={confirmDeleteSupplier}
        title="Supprimer ce fournisseur ?"
        message={deleteSupplierTarget ? `Supprimer "${deleteSupplierTarget.name}" ? Ses achats associés seront aussi supprimés.` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Mark purchase fully paid */}
      <ConfirmDialog
        visible={!!markPaidTarget}
        onClose={() => setMarkPaidTarget(null)}
        onConfirm={async () => {
          if (!markPaidTarget) return;
          await recordPurchasePayment(markPaidTarget.id, markPaidTarget.totalAmount);
          setMarkPaidTarget(null);
          const data = await getPurchases();
          setPurchases(data);
        }}
        title="Marquer comme payé ?"
        message={markPaidTarget ? `${markPaidTarget.product} — ${formatGNF(purchaseDebt(markPaidTarget))}` : ''}
        confirmLabel="Payé ✓"
        icon="checkmark-circle-outline"
      />

      {/* Delete Purchase Confirm */}
      <ConfirmDialog
        visible={!!deletePurchaseTarget}
        onClose={() => setDeletePurchaseTarget(null)}
        onConfirm={async () => {
          if (!deletePurchaseTarget) return;
          await deletePurchase(deletePurchaseTarget.id);
          setPurchases((p) => p.filter((x) => x.id !== deletePurchaseTarget.id));
          setDeletePurchaseTarget(null);
        }}
        title="Supprimer cet achat ?"
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, marginBottom: 12, backgroundColor: palette.card, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: palette.mossSoft },
  tabText: { fontSize: 13, color: palette.muted, fontWeight: '500' },
  tabTextActive: { color: palette.moss, fontWeight: '700' },
  card: {
    backgroundColor: palette.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: palette.line,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: palette.moss },
  cardName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  cardSub: { fontSize: 13, color: palette.muted, marginTop: 2 },
  // Neutral by default — a running total isn't a warning. Only the "Dû aux
  // fournisseurs" row (shown conditionally, only when non-zero) tints
  // critical via totalLabelDue; a plain total shouldn't compete for the
  // same alarm color.
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, padding: 12, borderRadius: 10 },
  totalLabel: { fontSize: 14, color: palette.muted, fontWeight: '600' },
  totalValue: { fontSize: 14, color: palette.ink, fontWeight: '700' },
  totalLabelDue: { color: palette.critical },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  sheetSub: { fontSize: 14, color: palette.muted, marginBottom: 16 },
});
