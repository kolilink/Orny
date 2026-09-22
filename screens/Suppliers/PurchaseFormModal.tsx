import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Supplier, Purchase, StockItem } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getSuppliers } from '../../store/suppliers';
import { getStock, addStockItem } from '../../store/stock';
import { addPurchase } from '../../store/purchases';
import { formatGNF } from '../../utils/format';
import { getFactoryId } from '../../store/context';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, MoneyInput, Text } from '../../components/ui';

interface PurchaseFormModalProps {
  visible: boolean;
  onClose: () => void;
  // When provided, the purchase is locked to this supplier (opened from its
  // own account screen — matches Patron's "Passer une commande", which never
  // shows a supplier picker either, since the context already implies it).
  // When omitted, a "Fournisseur (optionnel)" picker is shown — the Achats
  // tab's own "+", which isn't scoped to any one supplier.
  initialSupplier?: Supplier | null;
  onSaved: () => void;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One AppModal for the whole "record a purchase" flow. Picking a supplier or
// a matière première is a row of horizontal chips (the exact pattern
// Bulks'/Ventes' own "Saveur" picker already uses) — tap once, done. An
// earlier version expanded a vertical list under the field instead; that
// pushed the rest of the form up and down like an accordion every time it
// opened or closed, which read as more disruptive than a picker should be.
// Chips never move anything else on screen.
export default function PurchaseFormModal({ visible, onClose, initialSupplier, onSaved }: PurchaseFormModalProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const locked = !!initialSupplier;

  const [newStockOpen, setNewStockOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  const [pSupplier, setPSupplier] = useState<Supplier | null>(initialSupplier ?? null);
  const [pProduct, setPProduct] = useState('');
  const [pStockItemId, setPStockItemId] = useState<string | undefined>(undefined);
  const [pQty, setPQty] = useState('');
  const [pUnit, setPUnit] = useState('kg');
  const [pUnitPrice, setPUnitPrice] = useState('');
  const [pPayment, setPPayment] = useState<'cash' | 'orange_money' | 'credit'>('cash');
  const [pDate, setPDate] = useState(toDateStr(new Date()));
  const [saving, setSaving] = useState(false);

  const [newMatName, setNewMatName] = useState('');
  const [newMatUnit, setNewMatUnit] = useState('');

  const draftKey = `purchase_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNewStockOpen(false);
    setPSupplier(initialSupplier ?? null);
    getSuppliers().then(setSuppliers);
    getStock().then(setStockItems);

    if (locked) return; // no draft recovery for a supplier-scoped quick add
    AsyncStorage.getItem(draftKey).then((raw) => {
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
        if (d.pSupplierId && d.pSupplierName) {
          setPSupplier({ id: d.pSupplierId, name: d.pSupplierName } as Supplier);
        }
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || locked) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({
        pProduct, pStockItemId, pQty, pUnit, pUnitPrice, pPayment, pDate,
        pSupplierId: pSupplier?.id, pSupplierName: pSupplier?.name,
      }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pProduct, pStockItemId, pQty, pUnit, pUnitPrice, pPayment, pDate, pSupplier]);

  function resetForm() {
    setPProduct(''); setPStockItemId(undefined); setPQty(''); setPUnitPrice('');
    setPPayment('cash'); setPDate(toDateStr(new Date())); setPSupplier(initialSupplier ?? null);
  }

  function selectStockItem(item: StockItem) {
    setPStockItemId(item.id);
    setPProduct(item.name);
    setPUnit(item.unit);
    setNewStockOpen(false);
  }

  function selectSupplier(s: Supplier | null) {
    setPSupplier(s);
    if (s) {
      const match = stockItems.find((si) => si.name.trim().toLowerCase() === s.product.trim().toLowerCase());
      if (match) selectStockItem(match);
    }
  }

  async function handleCreateStockItem() {
    if (!newMatName.trim() || !newMatUnit.trim()) return;
    const item = await addStockItem({
      name: newMatName.trim(), unit: newMatUnit.trim(), currentLevel: 0, alertThreshold: 0,
    });
    setStockItems((prev) => [...prev, item]);
    setNewMatName(''); setNewMatUnit('');
    selectStockItem(item);
  }

  async function handleSave() {
    const qty = parseFloat(pQty);
    const up = parseInt(pUnitPrice.replace(/\s/g, ''), 10);
    if (!pProduct.trim() || !qty || qty <= 0 || !up || up <= 0) return;
    setSaving(true);
    const totalAmount = Math.round(qty * up);
    try {
      await addPurchase({
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
        // the moment of purchase, credit means nothing paid yet.
        amountPaid: pPayment !== 'credit' ? totalAmount : 0,
        paymentMethod: pPayment,
      });
      if (!locked) AsyncStorage.removeItem(draftKey);
      resetForm();
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!pProduct.trim() && !!parseFloat(pQty) && !!parseInt(pUnitPrice.replace(/\s/g, ''), 10);

  return (
    <AppModal visible={visible} onClose={onClose} title="Nouvel achat">
      <>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {locked ? (
            <Text style={styles.lockedSupplier}>{pSupplier?.name}</Text>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Fournisseur</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={styles.pillRow}>
                  <TouchableOpacity style={[styles.pill, !pSupplier && styles.pillActive]} onPress={() => selectSupplier(null)}>
                    <Text style={[styles.pillText, !pSupplier && styles.pillTextActive]}>Aucun</Text>
                  </TouchableOpacity>
                  {suppliers.map((s) => (
                    <TouchableOpacity key={s.id} style={[styles.pill, pSupplier?.id === s.id && styles.pillActive]} onPress={() => selectSupplier(s)}>
                      <Text style={[styles.pillText, pSupplier?.id === s.id && styles.pillTextActive]}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </>
          )}

          <Text style={styles.fieldLabel}>Produit *</Text>
          {stockItems.length === 0 && !newStockOpen ? (
            <Text style={styles.emptyHint}>Aucun article de stock pour l'instant</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={styles.pillRow}>
                {stockItems.map((item) => (
                  <TouchableOpacity key={item.id} style={[styles.pill, pStockItemId === item.id && styles.pillActive]} onPress={() => selectStockItem(item)}>
                    <Text style={[styles.pillText, pStockItemId === item.id && styles.pillTextActive]}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.pillAdd} onPress={() => setNewStockOpen((v) => !v)}>
                  <Ionicons name="add" size={18} color={palette.moss} />
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
          {newStockOpen && (
            <View style={styles.newMatInline}>
              <TextInput style={styles.input} value={newMatName} onChangeText={setNewMatName} placeholder="Nom" placeholderTextColor={palette.muted} autoFocus />
              <TextInput style={styles.input} value={newMatUnit} onChangeText={setNewMatUnit} placeholder="Unité (kg, L, sac…)" placeholderTextColor={palette.muted} />
              <Button label="Créer" onPress={handleCreateStockItem} fullWidth disabled={!newMatName.trim() || !newMatUnit.trim()} style={{ marginTop: 4 }} />
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Quantité *</Text>
              <TextInput style={styles.input} value={pQty} onChangeText={setPQty} placeholder="0" placeholderTextColor={palette.muted} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Unité</Text>
              <TextInput style={styles.input} value={pUnit} onChangeText={setPUnit} placeholder="kg, sacs..." placeholderTextColor={palette.muted} />
            </View>
          </View>
          <Text style={styles.fieldLabel}>Prix unitaire (GNF) *</Text>
          <MoneyInput style={styles.input} value={pUnitPrice} onChangeText={setPUnitPrice} />
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
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSave} loading={saving} disabled={!canSave} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </>
    </AppModal>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  lockedSupplier: { fontSize: 13, color: palette.muted, marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  emptyHint: { fontSize: 13, color: palette.muted, fontStyle: 'italic' },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  totalPreview: { fontSize: 14, fontWeight: '700', color: palette.moss, marginTop: 6, textAlign: 'right' },
  methodBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper, alignItems: 'center' },
  methodBtnActive: { borderColor: palette.moss, backgroundColor: palette.mossSoft },
  methodText: { fontSize: 13, color: palette.muted },
  methodTextActive: { color: palette.moss, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  // Horizontal chips — tap once, done. Never pushes the rest of the form
  // around the way an expand/collapse list did.
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line,
  },
  pillActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  pillText: { fontSize: 14, color: palette.ink, fontWeight: '500' },
  pillTextActive: { color: palette.white },
  pillAdd: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.mossSoft, borderWidth: 1, borderColor: palette.line,
  },
  newMatInline: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1, borderColor: palette.line,
    padding: 12, gap: 10, marginTop: 8,
  },
});
