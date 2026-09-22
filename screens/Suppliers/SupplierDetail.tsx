import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Supplier, Purchase, RootStackParamList, purchaseDebt } from '../../types';
import { getSuppliers, updateSupplier, deleteSupplier } from '../../store/suppliers';
import { getPurchases, recordPurchasePayment, deletePurchase } from '../../store/purchases';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, PhoneInput, switchModal, Text } from '../../components/ui';
import MonthGroup from './MonthGroup';
import PurchaseFormModal from './PurchaseFormModal';

type DetailNav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'SupplierDetail'>;

// One supplier's account: what they've been ordered, what's left, and when
// it was last paid — mirrors Patron's fournisseur profile screen (centered
// hero, an outlined call pill, a debt banner only when something's actually
// owed, purchases grouped by month, a pinned "+ Nouvel achat" CTA) rather
// than a bordered-card, always-visible-totals layout.
export default function SupplierDetailScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation<DetailNav>();
  const { params } = useRoute<DetailRoute>();
  const insets = useSafeAreaInsets();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  const [menuVisible, setMenuVisible] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sProduct, setSProduct] = useState('');
  const [sNotes, setSNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteSupplierConfirm, setDeleteSupplierConfirm] = useState(false);

  const [purchaseModal, setPurchaseModal] = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState<Purchase | null>(null);
  const [partialTarget, setPartialTarget] = useState<Purchase | null>(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [deletePurchaseTarget, setDeletePurchaseTarget] = useState<Purchase | null>(null);

  const load = useCallback(async () => {
    const [suppliers, allPurchases] = await Promise.all([getSuppliers(), getPurchases()]);
    const found = suppliers.find((s) => s.id === params.supplierId) ?? null;
    setSupplier(found);
    setPurchases(allPurchases.filter((p) => p.supplierId === params.supplierId));
  }, [params.supplierId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Native header stays (consistent with the rest of the app); the two
  // visible pencil/trash icons from round 1 are now one "•••" that opens a
  // small menu — matches Patron's own single ellipsis affordance, and avoids
  // needing Alert.alert (broken with 3+ buttons on this app's web target).
  useLayoutEffect(() => {
    if (supplier) navigation.setOptions({ title: supplier.name });
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuVisible(true)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={22} color={palette.moss} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, supplier, palette.moss]);

  function openEdit() {
    if (!supplier) return;
    setSName(supplier.name);
    setSPhone(supplier.phone ?? '');
    setSProduct(supplier.product);
    setSNotes(supplier.notes ?? '');
    setEditModal(true);
  }

  async function handleSaveSupplier() {
    if (!supplier || !sName.trim() || !sProduct.trim()) return;
    setSaving(true);
    try {
      await updateSupplier(supplier.id, {
        name: sName.trim(), phone: sPhone.trim() || undefined,
        product: sProduct.trim(), notes: sNotes.trim() || undefined,
      });
      setEditModal(false);
      await load();
    } finally {
      setSaving(false);
    }
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
    await load();
  }

  const totalOwed = purchases.reduce((sum, p) => sum + purchaseDebt(p), 0);

  const call = () => {
    if (!supplier?.phone) return;
    Linking.openURL(`tel:${supplier.phone}`).catch(() => {});
  };

  if (!supplier) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{supplier.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{supplier.name}</Text>
          {!!supplier.product && <Text style={styles.caption}>{supplier.product}</Text>}
          {!!supplier.notes && <Text style={styles.caption}>{supplier.notes}</Text>}
          {!!supplier.phone && (
            <TouchableOpacity style={styles.callBtn} onPress={call}>
              <Ionicons name="call-outline" size={15} color={palette.moss} />
              <Text style={styles.callText}>Appeler</Text>
            </TouchableOpacity>
          )}
        </View>

        {totalOwed > 0 && (
          // Purely informational — unlike Patron, Orny has no single
          // aggregate supplier-level debt to pay down in one action; every
          // payment is tied to one specific purchase (amountPaid on that
          // row), so the actual "Payé ✓"/"Partiel" actions live per-purchase
          // in the list below, never here.
          <View style={styles.debtBanner}>
            <Text style={styles.debtLabel}>Montant dû</Text>
            <Text style={styles.debtAmount}>{formatGNF(totalOwed)}</Text>
          </View>
        )}

        {purchases.length === 0 ? (
          <Text style={styles.empty}>Aucun achat pour {supplier.name}</Text>
        ) : (
          <MonthGroup
            purchases={purchases}
            showSupplierName={false}
            onMarkPaid={setMarkPaidTarget}
            onPartial={(target) => { setPartialTarget(target); setPartialAmount(''); }}
            onDelete={setDeletePurchaseTarget}
          />
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Button label="Faire un achat" fullWidth size="lg" onPress={() => setPurchaseModal(true)} />
      </View>

      {/* Overflow menu: Modifier / Supprimer */}
      <AppModal visible={menuVisible} onClose={() => setMenuVisible(false)} showCloseButton={false}>
        <TouchableOpacity style={styles.menuRow} onPress={() => switchModal(() => setMenuVisible(false), openEdit)}>
          <Ionicons name="pencil-outline" size={18} color={palette.ink} />
          <Text style={styles.menuRowText}>Modifier</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => switchModal(() => setMenuVisible(false), () => setDeleteSupplierConfirm(true))}>
          <Ionicons name="trash-outline" size={18} color={palette.critical} />
          <Text style={[styles.menuRowText, { color: palette.critical }]}>Supprimer</Text>
        </TouchableOpacity>
      </AppModal>

      {/* Edit supplier */}
      <AppModal visible={editModal} onClose={() => setEditModal(false)} title="Modifier fournisseur">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom *</Text>
          <TextInput style={styles.input} value={sName} onChangeText={setSName} placeholder="Nom du fournisseur" placeholderTextColor={palette.muted} />
          <Text style={styles.fieldLabel}>Produit fourni *</Text>
          <TextInput style={styles.input} value={sProduct} onChangeText={setSProduct} placeholder="Ex: Farine, ciment" placeholderTextColor={palette.muted} />
          <PhoneInput label="Téléphone" value={sPhone} onChangeText={setSPhone} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={styles.input} value={sNotes} onChangeText={setSNotes} placeholderTextColor={palette.muted} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setEditModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSaveSupplier} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Delete supplier */}
      <ConfirmDialog
        visible={deleteSupplierConfirm}
        onClose={() => setDeleteSupplierConfirm(false)}
        onConfirm={async () => {
          await deleteSupplier(supplier.id);
          setDeleteSupplierConfirm(false);
          navigation.goBack();
        }}
        title="Supprimer ce fournisseur ?"
        message={`Supprimer "${supplier.name}" ? Ses achats associés seront aussi supprimés.`}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* New purchase, locked to this supplier */}
      <PurchaseFormModal
        visible={purchaseModal}
        onClose={() => setPurchaseModal(false)}
        initialSupplier={supplier}
        onSaved={load}
      />

      {/* Mark purchase fully paid */}
      <ConfirmDialog
        visible={!!markPaidTarget}
        onClose={() => setMarkPaidTarget(null)}
        onConfirm={async () => {
          if (!markPaidTarget) return;
          await recordPurchasePayment(markPaidTarget.id, markPaidTarget.totalAmount);
          setMarkPaidTarget(null);
          await load();
        }}
        title="Marquer comme payé ?"
        message={markPaidTarget ? `${markPaidTarget.product} — ${formatGNF(purchaseDebt(markPaidTarget))}` : ''}
        confirmLabel="Payé ✓"
        icon="checkmark-circle-outline"
      />

      {/* Partial payment */}
      <AppModal visible={!!partialTarget} onClose={() => setPartialTarget(null)} title="Paiement partiel">
        {partialTarget && (
          <>
            <Text style={styles.sheetSub}>{partialTarget.product} — Reste à payer : {formatGNF(purchaseDebt(partialTarget))}</Text>
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

      {/* Delete purchase */}
      <ConfirmDialog
        visible={!!deletePurchaseTarget}
        onClose={() => setDeletePurchaseTarget(null)}
        onConfirm={async () => {
          if (!deletePurchaseTarget) return;
          await deletePurchase(deletePurchaseTarget.id);
          setDeletePurchaseTarget(null);
          await load();
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
  content: { paddingBottom: 100, paddingHorizontal: 20 },
  hero: { alignItems: 'center', paddingTop: 32, paddingBottom: 24 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '700', color: palette.moss },
  name: { fontSize: 22, fontWeight: '700', color: palette.ink, marginTop: 12, textAlign: 'center' },
  caption: { fontSize: 13, color: palette.muted, marginTop: 4, textAlign: 'center' },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: palette.moss,
  },
  callText: { fontSize: 14, fontWeight: '600', color: palette.moss },
  debtBanner: {
    marginBottom: 20, padding: 16, borderRadius: 12,
    backgroundColor: palette.criticalSoft,
  },
  debtLabel: { fontSize: 13, color: palette.critical, fontWeight: '600' },
  debtAmount: { fontSize: 18, fontWeight: '700', color: palette.critical, marginTop: 2 },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 24, fontSize: 14, lineHeight: 22 },
  footer: {
    padding: 16, backgroundColor: palette.paper,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line,
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuRowText: { fontSize: 16, color: palette.ink, fontWeight: '500' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  sheetSub: { fontSize: 14, color: palette.muted, marginBottom: 16 },
});
