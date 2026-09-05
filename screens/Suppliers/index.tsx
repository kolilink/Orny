import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Supplier, Purchase, StockItem, isPurchasePaid, purchaseDebt } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, syncSuppliersFromSupabase } from '../../store/suppliers';
import { getPurchases, addPurchase, deletePurchase, recordPurchasePayment, syncPurchasesFromSupabase } from '../../store/purchases';
import { getStock, addStockItem, syncStockFromSupabase } from '../../store/stock';
import { formatGNF } from '../../utils/format';
import { getFactoryId } from '../../store/context';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SuppliersScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation();
  const [tab, setTab] = useState<'suppliers' | 'purchases'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

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
  const [pStockItemId, setPStockItemId] = useState<string | undefined>(undefined);
  const [pQty, setPQty] = useState('');
  const [pUnit, setPUnit] = useState('kg');
  const [pUnitPrice, setPUnitPrice] = useState('');
  const [pPayment, setPPayment] = useState<'cash' | 'orange_money' | 'credit'>('cash');
  const [pDate, setPDate] = useState(toDateStr(new Date()));
  const [pNotes, setPNotes] = useState('');
  const [supplierPickerVisible, setSupplierPickerVisible] = useState(false);
  const [stockPickerVisible, setStockPickerVisible] = useState(false);
  const [newMatModal, setNewMatModal] = useState(false);
  const [newMatName, setNewMatName] = useState('');
  const [newMatUnit, setNewMatUnit] = useState('');

  // ── Draft persistence (purchase form) ─────────────────────────
  const purchaseDraftKey = `purchase_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(purchaseDraftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.pProduct) setPProduct(d.pProduct);
        if (d.pStockItemId) setPStockItemId(d.pStockItemId);
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
        pProduct, pStockItemId, pQty, pUnit, pUnitPrice, pPayment, pDate, pNotes,
        pSupplierId: pSupplier?.id, pSupplierName: pSupplier?.name,
      }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pProduct, pStockItemId, pQty, pUnit, pUnitPrice, pPayment, pDate, pNotes, pSupplier]);

  const load = useCallback(async () => {
    syncSuppliersFromSupabase();
    syncPurchasesFromSupabase();
    syncStockFromSupabase();
    const [s, p, st] = await Promise.all([getSuppliers(), getPurchases(), getStock()]);
    setSuppliers(s);
    setPurchases(p);
    setStockItems(st);
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
    const totalAmount = Math.round(qty * up);
    const item = await addPurchase({
      supplierId: pSupplier?.id,
      supplierName: pSupplier?.name ?? 'Inconnu',
      date: pDate,
      product: pProduct.trim(),
      stockItemId: pStockItemId,
      quantity: qty,
      unit: pUnit.trim() || 'kg',
      unitPrice: up,
      totalAmount,
      // Same convention as a sale: cash/Orange Money means paid in full at
      // the moment of purchase, credit means nothing paid yet — the owed
      // amount is tracked from here on, not lost the moment the form closes.
      amountPaid: pPayment !== 'credit' ? totalAmount : 0,
      paymentMethod: pPayment,
      notes: pNotes.trim() || undefined,
    });
    setPProduct(''); setPStockItemId(undefined); setPQty(''); setPUnitPrice(''); setPNotes('');
    setPPayment('cash'); setPDate(toDateStr(new Date())); setPSupplier(null);
    AsyncStorage.removeItem(purchaseDraftKey);
    setPurchaseModal(false);
    setPurchases(prev => [item, ...prev]);
    // Purchase already bumped the stock item's level in the store — refresh
    // so the next purchase modal shows the up-to-date "en stock" quantity.
    getStock().then(setStockItems);
  }

  function selectStockItem(item: StockItem) {
    setPStockItemId(item.id);
    setPProduct(item.name);
    setPUnit(item.unit);
    setStockPickerVisible(false);
  }

  async function handleCreateStockItem() {
    if (!newMatName.trim() || !newMatUnit.trim()) return;
    const item = await addStockItem({
      name: newMatName.trim(),
      unit: newMatUnit.trim(),
      currentLevel: 0,
      alertThreshold: 0,
    });
    setStockItems((prev) => [...prev, item]);
    selectStockItem(item);
    setNewMatName(''); setNewMatUnit('');
    setNewMatModal(false);
  }

  async function confirmDeletePurchase() {
    if (!deletePurchaseId) return;
    await deletePurchase(deletePurchaseId);
    setPurchases((p) => p.filter((x) => x.id !== deletePurchaseId));
    setDeletePurchaseId(null);
  }

  async function handleMarkPurchasePaid(purchase: Purchase) {
    await recordPurchasePayment(purchase.id, purchase.totalAmount);
    setPurchases((prev) => prev.map((p) => (p.id === purchase.id ? { ...p, amountPaid: p.totalAmount } : p)));
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
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={styles.iconWrap}>
                  <Ionicons name="business" size={20} color={palette.moss} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardSub}>{item.product}{item.phone ? `  ·  ${item.phone}` : ''}</Text>
                  {!!item.notes && <Text style={styles.cardNotes}>{item.notes}</Text>}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity onPress={() => openEditSupplier(item)} style={{ padding: 6 }}>
                  <Ionicons name="pencil-outline" size={18} color={palette.moss} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDeleteSupplierTarget(item)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={palette.critical} />
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
              <View style={{ gap: 8, marginBottom: 12 }}>
                <View style={[styles.totalRow, { marginBottom: 0 }]}>
                  <Text style={styles.totalLabel}>Total achats</Text>
                  <Text style={styles.totalValue}>{formatGNF(totalPurchases)}</Text>
                </View>
                {totalOwed > 0 && (
                  <View style={[styles.totalRow, { marginBottom: 0, backgroundColor: palette.criticalSoft }]}>
                    <Text style={[styles.totalLabel, { color: palette.critical }]}>Dû aux fournisseurs</Text>
                    <Text style={[styles.totalValue, { color: palette.critical }]}>{formatGNF(totalOwed)}</Text>
                  </View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>Aucun achat enregistré{'\n'}Appuyez sur + pour en ajouter un</Text>}
          renderItem={({ item }) => {
            const paid = isPurchasePaid(item);
            const debt = purchaseDebt(item);
            return (
              <View style={styles.card}>
                <View style={styles.cardLeft}>
                  <View style={[styles.iconWrap, { backgroundColor: palette.cautionSoft }]}>
                    <Ionicons name="cart" size={20} color={palette.caution} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{item.product}</Text>
                    <Text style={styles.cardSub}>{item.supplierName}  ·  {item.quantity} {item.unit}  ·  {item.date}</Text>
                    {!paid && (
                      <Text style={[styles.cardSub, { color: palette.critical, fontWeight: '600', marginTop: 3 }]}>
                        Dû : {formatGNF(debt)}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.cardName, { color: palette.critical }]}>{formatGNF(item.totalAmount)}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    {!paid && (
                      <TouchableOpacity onPress={() => handleMarkPurchasePaid(item)} style={{ padding: 4 }}>
                        <Ionicons name="checkmark-circle-outline" size={18} color={palette.moss} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setDeletePurchaseId(item.id)} style={{ padding: 4 }}>
                      <Ionicons name="trash-outline" size={16} color={palette.critical} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Add / Edit Supplier Modal */}
      <Modal visible={supplierModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSupplierModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{editingSupplier ? 'Modifier fournisseur' : 'Nouveau fournisseur'}</Text>
          <ScrollView>
            <Text style={styles.fieldLabel}>Nom *</Text>
            <TextInput style={styles.input} value={sName} onChangeText={setSName} placeholder="Ex: Mamadou Diallo" placeholderTextColor={palette.muted} />
            <Text style={styles.fieldLabel}>Produit fourni *</Text>
            <TextInput style={styles.input} value={sProduct} onChangeText={setSProduct} placeholder="Ex: Farine, matière première..." placeholderTextColor={palette.muted} />
            <Text style={styles.fieldLabel}>Téléphone</Text>
            <TextInput style={styles.input} value={sPhone} onChangeText={setSPhone} placeholder="Ex: 622 00 00 00" placeholderTextColor={palette.muted} keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={styles.input} value={sNotes} onChangeText={setSNotes} placeholder="Notes optionnelles" placeholderTextColor={palette.muted} />
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
              <Ionicons name="chevron-down" size={16} color={palette.muted} />
            </TouchableOpacity>
            <Text style={styles.fieldLabel}>Produit / matière première *</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setStockPickerVisible(true)}>
              <Text style={styles.pickerBtnText}>{pProduct || 'Sélectionner une matière première'}</Text>
              <Ionicons name="chevron-down" size={16} color={palette.muted} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantité *</Text>
                <TextInput style={styles.input} value={pQty} onChangeText={setPQty} placeholder="Ex: 100" placeholderTextColor={palette.muted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Unité</Text>
                <TextInput style={styles.input} value={pUnit} onChangeText={setPUnit} placeholder="kg, sacs..." placeholderTextColor={palette.muted} />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Prix unitaire (GNF) *</Text>
            <TextInput style={styles.input} value={pUnitPrice} onChangeText={setPUnitPrice} placeholder="Ex: 1500" placeholderTextColor={palette.muted} keyboardType="numeric" />
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
            <TextInput style={styles.input} value={pNotes} onChangeText={setPNotes} placeholder="Optionnel" placeholderTextColor={palette.muted} />
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
            <TouchableOpacity
              key={s.id}
              style={styles.supplierRow}
              onPress={() => {
                setPSupplier(s);
                // Convenience: if a stock item already matches this supplier's
                // known product, pre-select it — otherwise the user still
                // picks (or creates) one explicitly via the Produit field.
                const match = stockItems.find((si) => si.name.trim().toLowerCase() === s.product.trim().toLowerCase());
                if (match) selectStockItem(match);
                setSupplierPickerVisible(false);
              }}
            >
              <Text style={styles.supplierRowText}>{s.name}</Text>
              <Text style={styles.supplierRowSub}>{s.product}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Stock item picker inside purchase modal */}
      <Modal visible={stockPickerVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setStockPickerVisible(false)} />
        <View style={[styles.sheet, { maxHeight: 460 }]}>
          <Text style={styles.sheetTitle}>Choisir une matière première</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {stockItems.map((item) => (
              <TouchableOpacity key={item.id} style={styles.supplierRow} onPress={() => selectStockItem(item)}>
                <Text style={styles.supplierRowText}>{item.name}</Text>
                <Text style={styles.supplierRowSub}>{item.currentLevel} {item.unit} en stock</Text>
              </TouchableOpacity>
            ))}
            {stockItems.length === 0 && (
              <Text style={styles.empty}>Aucun article de stock pour l'instant</Text>
            )}
          </ScrollView>
          <TouchableOpacity
            style={styles.addMatBtn}
            onPress={() => { setStockPickerVisible(false); setNewMatModal(true); }}
          >
            <Ionicons name="add" size={18} color={palette.moss} />
            <Text style={styles.addMatBtnText}>+ Nouvelle matière première</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* New stock item modal */}
      <Modal visible={newMatModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setNewMatModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Nouvelle matière première</Text>
          <Text style={styles.fieldLabel}>Nom</Text>
          <TextInput style={styles.input} value={newMatName} onChangeText={setNewMatName} placeholder="Ex: Sel, Farine…" placeholderTextColor={palette.muted} autoFocus />
          <Text style={styles.fieldLabel}>Unité</Text>
          <TextInput style={styles.input} value={newMatUnit} onChangeText={setNewMatUnit} placeholder="kg, L, sac…" placeholderTextColor={palette.muted} />
          <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateStockItem}>
            <Text style={styles.confirmBtnText}>Créer</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete Supplier Confirm */}
      <Modal visible={!!deleteSupplierTarget} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: 12 }} />
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
            <Ionicons name="trash-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: 12 }} />
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

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: palette.paper, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: palette.card },
  tabText: { fontSize: 13, color: palette.muted, fontWeight: '500' },
  tabTextActive: { color: palette.ink, fontWeight: '700' },
  card: { backgroundColor: palette.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: '600', color: palette.ink },
  cardSub: { fontSize: 12, color: palette.muted, marginTop: 2 },
  cardNotes: { fontSize: 12, color: palette.muted, fontStyle: 'italic', marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, backgroundColor: palette.cautionSoft, padding: 12, borderRadius: 10 },
  totalLabel: { fontSize: 14, color: palette.caution, fontWeight: '600' },
  totalValue: { fontSize: 14, color: palette.caution, fontWeight: '700' },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: palette.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  pickerBtn: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerBtnText: { fontSize: 16, color: palette.ink },
  totalPreview: { fontSize: 14, fontWeight: '700', color: palette.moss, marginTop: 6, textAlign: 'right' },
  methodBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper, alignItems: 'center' },
  methodBtnActive: { borderColor: palette.moss, backgroundColor: palette.mossSoft },
  methodText: { fontSize: 13, color: palette.muted },
  methodTextActive: { color: palette.moss, fontWeight: '700' },
  confirmBtn: { marginTop: 20, backgroundColor: palette.moss, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  supplierRow: { paddingVertical: 14, borderBottomWidth: 1, borderColor: palette.line },
  supplierRowText: { fontSize: 15, color: palette.ink, fontWeight: '500' },
  supplierRowSub: { fontSize: 12, color: palette.muted, marginTop: 2 },
  addMatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingVertical: 12, backgroundColor: palette.mossSoft, borderRadius: 10,
  },
  addMatBtnText: { fontSize: 14, color: palette.moss, fontWeight: '600' },
  // confirm modals
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: palette.card, borderRadius: 20, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, textAlign: 'center', marginBottom: 8 },
  confirmSub: { fontSize: 14, color: palette.muted, textAlign: 'center', marginBottom: 4, lineHeight: 20 },
  confirmBtnRed: { marginTop: 16, backgroundColor: palette.critical, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtn: { marginTop: 10, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: palette.line },
  cancelBtnText: { color: palette.muted, fontWeight: '600', fontSize: 15 },
});
