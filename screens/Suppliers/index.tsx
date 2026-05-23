import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Supplier, Purchase } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, syncSuppliersFromSupabase } from '../../store/suppliers';
import { getPurchases, addPurchase, deletePurchase, syncPurchasesFromSupabase } from '../../store/purchases';
import { formatGNF } from '../../utils/format';
import { getFactoryId } from '../../store/context';

const C = {
  primary: '#1D9E75', red: '#E24B4A', orange: '#EF9F27',
  bg: '#F8F8F6', card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SuppliersScreen() {
  const insets = useSafeAreaInsets();
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

  // ── Delete confirm modals ──────────────────────────────────────
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState<Supplier | null>(null);
  const [deletePurchaseId, setDeletePurchaseId] = useState<string | null>(null);

  // ── Purchase form modal ────────────────────────────────────────
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [pSupplier, setPSupplier] = useState<Supplier | null>(null);
  const [pProduct, setPProduct] = useState('');
  const [pQty, setPQty] = useState('');
  const [pUnit, setPUnit] = useState('kg');
  const [pUnitPrice, setPUnitPrice] = useState('');
  const [pPayment, setPPayment] = useState<'cash' | 'orange_money' | 'credit'>('cash');
  const [pDate, setPDate] = useState(toDateStr(new Date()));
  const [pNotes, setPNotes] = useState('');
  const [supplierPickerVisible, setSupplierPickerVisible] = useState(false);

  // ── Draft persistence (purchase form) ─────────────────────────
  const purchaseDraftKey = `purchase_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(purchaseDraftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.pProduct) setPProduct(d.pProduct);
        if (d.pQty) setPQty(d.pQty);
        if (d.pUnit) setPUnit(d.pUnit);
        if (d.pUnitPrice) setPUnitPrice(d.pUnitPrice);
        if (d.pPayment) setPPayment(d.pPayment);
        if (d.pDate) setPDate(d.pDate);
        if (d.pNotes) setPNotes(d.pNotes);
        if (d.pSupplierId && d.pSupplierName) {
          setPSupplier({ id: d.pSupplierId, name: d.pSupplierName } as Supplier);
        }
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(purchaseDraftKey, JSON.stringify({
        pProduct, pQty, pUnit, pUnitPrice, pPayment, pDate, pNotes,
        pSupplierId: pSupplier?.id, pSupplierName: pSupplier?.name,
      }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pProduct, pQty, pUnit, pUnitPrice, pPayment, pDate, pNotes, pSupplier]);

  const load = useCallback(async () => {
    syncSuppliersFromSupabase();
    syncPurchasesFromSupabase();
    const [s, p] = await Promise.all([getSuppliers(), getPurchases()]);
    setSuppliers(s);
    setPurchases(p);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openAddSupplier() {
    setEditingSupplier(null);
    setSName(''); setSPhone(''); setSProduct(''); setSNotes('');
    setSupplierModal(true);
  }

  function openEditSupplier(s: Supplier) {
    setEditingSupplier(s);
    setSName(s.name); setSPhone(s.phone ?? ''); setSProduct(s.product); setSNotes(s.notes ?? '');
    setSupplierModal(true);
  }

  async function handleSaveSupplier() {
    if (!sName.trim()) return;
    if (!sProduct.trim()) return;
    if (editingSupplier) {
      await updateSupplier(editingSupplier.id, {
        name: sName.trim(), phone: sPhone.trim() || undefined,
        product: sProduct.trim(), notes: sNotes.trim() || undefined,
      });
    } else {
      await addSupplier({ name: sName.trim(), phone: sPhone.trim() || undefined, product: sProduct.trim(), notes: sNotes.trim() || undefined });
    }
    setSName(''); setSPhone(''); setSProduct(''); setSNotes('');
    setSupplierModal(false);
    const data = await getSuppliers();
    setSuppliers(data);
  }

  async function confirmDeleteSupplier() {
    if (!deleteSupplierTarget) return;
    await deleteSupplier(deleteSupplierTarget.id);
    setSuppliers((p) => p.filter((s) => s.id !== deleteSupplierTarget.id));
    setDeleteSupplierTarget(null);
  }

  async function handleAddPurchase() {
    const qty = parseFloat(pQty);
    const up = parseInt(pUnitPrice.replace(/\s/g, ''), 10);
    if (!pProduct.trim() || !qty || qty <= 0 || !up || up <= 0) return;
    const item = await addPurchase({
      supplierId: pSupplier?.id,
      supplierName: pSupplier?.name ?? 'Inconnu',
      date: pDate,
      product: pProduct.trim(),
      quantity: qty,
      unit: pUnit.trim() || 'kg',
      unitPrice: up,
      totalAmount: Math.round(qty * up),
      paymentMethod: pPayment,
      notes: pNotes.trim() || undefined,
    });
    setPProduct(''); setPQty(''); setPUnitPrice(''); setPNotes('');
    setPPayment('cash'); setPDate(toDateStr(new Date())); setPSupplier(null);
    AsyncStorage.removeItem(purchaseDraftKey);
    setPurchaseModal(false);
    setPurchases(prev => [item, ...prev]);
  }

  async function confirmDeletePurchase() {
    if (!deletePurchaseId) return;
    await deletePurchase(deletePurchaseId);
    setPurchases((p) => p.filter((x) => x.id !== deletePurchaseId));
    setDeletePurchaseId(null);
  }

  const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Fournisseurs & Achats</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => tab === 'suppliers' ? openAddSupplier() : setPurchaseModal(true)}
        >
          <Ionicons name="add" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

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
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={styles.iconWrap}>
                  <Ionicons name="business" size={20} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardSub}>{item.product}{item.phone ? `  ·  ${item.phone}` : ''}</Text>
                  {!!item.notes && <Text style={styles.cardNotes}>{item.notes}</Text>}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity onPress={() => openEditSupplier(item)} style={{ padding: 6 }}>
                  <Ionicons name="pencil-outline" size={18} color={C.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDeleteSupplierTarget(item)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={C.red} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={purchases}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={
            purchases.length > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total achats</Text>
                <Text style={styles.totalValue}>{formatGNF(totalPurchases)}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>Aucun achat enregistré{'\n'}Appuyez sur + pour en ajouter un</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={[styles.iconWrap, { backgroundColor: '#FFF3E6' }]}>
                  <Ionicons name="cart" size={20} color={C.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.product}</Text>
                  <Text style={styles.cardSub}>{item.supplierName}  ·  {item.quantity} {item.unit}  ·  {item.date}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.cardName, { color: C.red }]}>{formatGNF(item.totalAmount)}</Text>
                <TouchableOpacity onPress={() => setDeletePurchaseId(item.id)} style={{ padding: 4, marginTop: 4 }}>
                  <Ionicons name="trash-outline" size={16} color={C.red} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Add / Edit Supplier Modal */}
      <Modal visible={supplierModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSupplierModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{editingSupplier ? 'Modifier fournisseur' : 'Nouveau fournisseur'}</Text>
          <ScrollView>
            <Text style={styles.fieldLabel}>Nom *</Text>
            <TextInput style={styles.input} value={sName} onChangeText={setSName} placeholder="Ex: Mamadou Diallo" placeholderTextColor={C.muted} />
            <Text style={styles.fieldLabel}>Produit fourni *</Text>
            <TextInput style={styles.input} value={sProduct} onChangeText={setSProduct} placeholder="Ex: Farine, matière première..." placeholderTextColor={C.muted} />
            <Text style={styles.fieldLabel}>Téléphone</Text>
            <TextInput style={styles.input} value={sPhone} onChangeText={setSPhone} placeholder="Ex: 622 00 00 00" placeholderTextColor={C.muted} keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={styles.input} value={sNotes} onChangeText={setSNotes} placeholder="Notes optionnelles" placeholderTextColor={C.muted} />
            <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveSupplier}>
              <Text style={styles.confirmBtnText}>{editingSupplier ? 'Mettre à jour' : 'Ajouter le fournisseur'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Add Purchase Modal */}
      <Modal visible={purchaseModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setPurchaseModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Nouvel achat</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Fournisseur</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setSupplierPickerVisible(true)}>
              <Text style={styles.pickerBtnText}>{pSupplier?.name ?? 'Sélectionner (optionnel)'}</Text>
              <Ionicons name="chevron-down" size={16} color={C.muted} />
            </TouchableOpacity>
            <Text style={styles.fieldLabel}>Produit *</Text>
            <TextInput style={styles.input} value={pProduct} onChangeText={setPProduct} placeholder="Ex: Farine, matière première..." placeholderTextColor={C.muted} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantité *</Text>
                <TextInput style={styles.input} value={pQty} onChangeText={setPQty} placeholder="Ex: 100" placeholderTextColor={C.muted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Unité</Text>
                <TextInput style={styles.input} value={pUnit} onChangeText={setPUnit} placeholder="kg, sacs..." placeholderTextColor={C.muted} />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Prix unitaire (GNF) *</Text>
            <TextInput style={styles.input} value={pUnitPrice} onChangeText={setPUnitPrice} placeholder="Ex: 1500" placeholderTextColor={C.muted} keyboardType="numeric" />
            {pQty && pUnitPrice ? (
              <Text style={styles.totalPreview}>Total : {formatGNF(parseFloat(pQty) * parseInt(pUnitPrice.replace(/\s/g, ''), 10) || 0)}</Text>
            ) : null}
            <DatePickerField label="Date" value={pDate} onChange={setPDate} />
            <Text style={styles.fieldLabel}>Mode de paiement</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['cash', 'orange_money', 'credit'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodBtn, pPayment === m && styles.methodBtnActive]}
                  onPress={() => setPPayment(m)}
                >
                  <Text style={[styles.methodText, pPayment === m && styles.methodTextActive]}>
                    {m === 'cash' ? 'Cash' : m === 'orange_money' ? 'Orange' : 'Crédit'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={styles.input} value={pNotes} onChangeText={setPNotes} placeholder="Optionnel" placeholderTextColor={C.muted} />
            <TouchableOpacity style={styles.confirmBtn} onPress={handleAddPurchase}>
              <Text style={styles.confirmBtnText}>Enregistrer l'achat</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Supplier picker inside purchase modal */}
      <Modal visible={supplierPickerVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSupplierPickerVisible(false)} />
        <View style={[styles.sheet, { maxHeight: 400 }]}>
          <Text style={styles.sheetTitle}>Choisir un fournisseur</Text>
          <TouchableOpacity style={styles.supplierRow} onPress={() => { setPSupplier(null); setSupplierPickerVisible(false); }}>
            <Text style={styles.supplierRowText}>Aucun / Manuel</Text>
          </TouchableOpacity>
          {suppliers.map((s) => (
            <TouchableOpacity key={s.id} style={styles.supplierRow} onPress={() => { setPSupplier(s); setPProduct(s.product); setSupplierPickerVisible(false); }}>
              <Text style={styles.supplierRowText}>{s.name}</Text>
              <Text style={styles.supplierRowSub}>{s.product}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Delete Supplier Confirm */}
      <Modal visible={!!deleteSupplierTarget} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer ce fournisseur ?</Text>
            <Text style={styles.confirmSub}>{deleteSupplierTarget?.name}{'\n'}Ses achats associés seront aussi supprimés.</Text>
            <TouchableOpacity style={styles.confirmBtnRed} onPress={confirmDeleteSupplier}>
              <Text style={styles.confirmBtnText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteSupplierTarget(null)}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete Purchase Confirm */}
      <Modal visible={!!deletePurchaseId} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer cet achat ?</Text>
            <TouchableOpacity style={styles.confirmBtnRed} onPress={confirmDeletePurchase}>
              <Text style={styles.confirmBtnText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeletePurchaseId(null)}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#EDEDEB', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: C.card },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  tabTextActive: { color: C.text, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#E8F6F0', alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: '600', color: C.text },
  cardSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  cardNotes: { fontSize: 12, color: C.muted, fontStyle: 'italic', marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, backgroundColor: '#FFF3E6', padding: 12, borderRadius: 10 },
  totalLabel: { fontSize: 14, color: C.orange, fontWeight: '600' },
  totalValue: { fontSize: 14, color: C.orange, fontWeight: '700' },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#F8F8F6', borderRadius: 12, padding: 14, fontSize: 16, color: C.text, borderWidth: 1, borderColor: C.border },
  pickerBtn: { backgroundColor: '#F8F8F6', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerBtnText: { fontSize: 16, color: C.text },
  totalPreview: { fontSize: 14, fontWeight: '700', color: C.primary, marginTop: 6, textAlign: 'right' },
  methodBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: '#F8F8F6', alignItems: 'center' },
  methodBtnActive: { borderColor: C.primary, backgroundColor: '#E8F6F0' },
  methodText: { fontSize: 13, color: C.muted },
  methodTextActive: { color: C.primary, fontWeight: '700' },
  confirmBtn: { marginTop: 20, backgroundColor: C.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  supplierRow: { paddingVertical: 14, borderBottomWidth: 1, borderColor: C.border },
  supplierRowText: { fontSize: 15, color: C.text, fontWeight: '500' },
  supplierRowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  // confirm modals
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: C.card, borderRadius: 20, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  confirmSub: { fontSize: 14, color: C.muted, textAlign: 'center', marginBottom: 4, lineHeight: 20 },
  confirmBtnRed: { marginTop: 16, backgroundColor: C.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtn: { marginTop: 10, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontWeight: '600', fontSize: 15 },
});
