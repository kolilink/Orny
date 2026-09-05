import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, FlatList, Modal, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSales, addSale, updateSale, deleteSale, syncSalesFromSupabase } from '../../store/sales';
import { getClients, upsertClient, syncClientsFromSupabase } from '../../store/clients';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, syncBulksFromSupabase } from '../../store/bulks';
import { checkStockAvailability, deductStock, ensureStockItem, getStock } from '../../store/stock';
import { Sale, ProductFlavor, BulkProduct, Client, saleDebt } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import { getFactoryId } from '../../store/context';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog } from '../../components/ui';

const PAYMENT_LABELS: Record<Sale['paymentMethod'], string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

// orange_money references Orange Money's own real-world brand color
// deliberately, not the app's caution/critical tokens — see the same note
// in screens/Reports/index.tsx.
const ORANGE_MONEY_BRAND = '#EF9F27';

const makePaymentColors = (palette: Palette): Record<Sale['paymentMethod'], string> => ({
  cash: palette.moss,
  orange_money: ORANGE_MONEY_BRAND,
  credit: palette.critical,
});

type ProductMode = 'flavor' | 'bulk';

type CartItem = {
  id: string;
  productType: ProductMode;
  product: string;
  productLabel: string;
  quantity: number;
  unitPrice: number;
};

export default function VentesScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const PAYMENT_COLORS = makePaymentColors(palette);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);

  const [clientQuery, setClientQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurSuppressedRef = useRef(false);

  const [productMode, setProductMode] = useState<ProductMode>('flavor');
  const [selectedFlavorId, setSelectedFlavorId] = useState('');
  const [selectedBulkId, setSelectedBulkId] = useState('');

  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Draft persistence ──────────────────────────────────────────
  const draftKey = `ventes_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.clientQuery) setClientQuery(d.clientQuery);
        if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
        if (d.cartItems?.length) setCartItems(d.cartItems);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ clientQuery, paymentMethod, cartItems }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientQuery, paymentMethod, cartItems]);

  const [detailSale, setDetailSale] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editForm, setEditForm] = useState<{
    clientName: string; quantity: number; unitPrice: number;
    paymentMethod: Sale['paymentMethod'];
  } | null>(null);

  const load = useCallback(async () => {
    await Promise.all([syncSalesFromSupabase(), syncClientsFromSupabase(), syncFlavorsFromSupabase(), syncBulksFromSupabase()]);
    const [s, cls, fl, bk] = await Promise.all([
      getSales(), getClients(), getFlavors(), getBulks(),
    ]);
    setSalesState(s);
    setAllClients(cls);
    setFlavorsState(fl);
    setBulksState(bk);
    if (fl.length > 0 && !selectedFlavorId) {
      setSelectedFlavorId(fl[0].id);
      setUnitPrice(fl[0].defaultPrice);
    }
    if (bk.length > 0 && !selectedBulkId) {
      setSelectedBulkId(bk[0].id);
    }
    // Self-heal: flavors/standalone bulks created before stock tracking
    // existed have no stock row yet — back-fill them at 0 so they show up
    // and can be topped up, instead of silently having nothing to deduct.
    await Promise.all([
      ...fl.map((f) => ensureStockItem(f.id, f.label, 'sachet')),
      ...bk.filter((b) => !b.flavorId).map((b) => ensureStockItem(b.id, b.name, 'unité')),
    ]);
  }, []);

  // Resolves what a cart item actually sells against in finished-goods
  // stock: a flavor deducts its own row; a bulk built on a flavor deducts
  // bagCount×qty from THAT flavor's row (a bulk is just a case of it, not
  // separate inventory); a standalone bulk deducts its own row.
  const resolveStockTarget = (item: CartItem): { stockId: string; amount: number } => {
    if (item.productType === 'bulk') {
      const bulk = bulks.find((b) => b.id === item.product);
      if (bulk?.flavorId) {
        return { stockId: bulk.flavorId, amount: item.quantity * bulk.bagCount };
      }
    }
    return { stockId: item.product, amount: item.quantity };
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const selectedFlavor = flavors.find((f) => f.id === selectedFlavorId);
  const selectedBulk = bulks.find((b) => b.id === selectedBulkId);

  const currentItemTotal = quantity * unitPrice;
  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const suggestions = clientQuery.length > 0
    ? allClients.filter((c) =>
        c.name.toLowerCase().includes(clientQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(clientQuery))
      )
    : [];

  const getProductLabel = (sale: Sale): string => {
    if (sale.productType === 'bulk') {
      return bulks.find((b) => b.id === sale.product)?.name ?? sale.product;
    }
    return flavors.find((f) => f.id === sale.product)?.label ?? sale.product;
  };

  const resetForm = () => {
    setClientQuery('');
    setQuantity(1);
    setPaymentMethod('cash');
    setShowSuggestions(false);
    setCartItems([]);
    AsyncStorage.removeItem(draftKey);
    if (productMode === 'flavor' && selectedFlavor) {
      setUnitPrice(selectedFlavor.defaultPrice);
    } else if (productMode === 'bulk' && selectedBulk) {
      setUnitPrice(selectedBulk.unitPrice);
    }
  };

  const handleSelectFlavor = (f: ProductFlavor) => {
    setSelectedFlavorId(f.id);
    setUnitPrice(f.defaultPrice);
  };

  const handleSelectBulk = (b: BulkProduct) => {
    setSelectedBulkId(b.id);
    setUnitPrice(b.unitPrice);
  };

  const handleModeChange = (mode: ProductMode) => {
    setProductMode(mode);
    if (mode === 'flavor' && selectedFlavor) {
      setUnitPrice(selectedFlavor.defaultPrice);
    } else if (mode === 'bulk' && selectedBulk) {
      setUnitPrice(selectedBulk.unitPrice);
    }
  };

  const handleAddToCart = () => {
    const productId = productMode === 'flavor' ? selectedFlavorId : selectedBulkId;
    if (!productId) {
      Alert.alert('Erreur', productMode === 'flavor'
        ? 'Aucune saveur disponible. Créez-en une dans Menu > Saveurs.'
        : 'Aucun lot disponible. Créez-en un dans Menu > Vrac.');
      return;
    }
    const label = productMode === 'flavor'
      ? flavors.find((f) => f.id === productId)?.label ?? productId
      : bulks.find((b) => b.id === productId)?.name ?? productId;

    setCartItems((prev) => [...prev, {
      id: Date.now().toString() + String(Math.random()),
      productType: productMode,
      product: productId,
      productLabel: label,
      quantity,
      unitPrice,
    }]);
    setQuantity(1);
  };

  const handleRemoveFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Aggregates cart items into { stockId: totalQtyNeeded }, merging a flavor
  // sold directly with the same flavor sold via a bulk built on it.
  const buildDeductions = (): Record<string, number> => {
    const deductions: Record<string, number> = {};
    for (const item of cartItems) {
      const { stockId, amount } = resolveStockTarget(item);
      deductions[stockId] = (deductions[stockId] ?? 0) + amount;
    }
    return deductions;
  };

  const finalizeSale = async () => {
    setSaving(true);
    try {
      await upsertClient(clientQuery.trim());
      // Real cost of goods for this sale — read each item's finished-goods
      // avgCost BEFORE stock is deducted (consumption never moves avgCost,
      // so before/after doesn't matter, but the deduction below needs the
      // combined quantities anyway). This is what Reports uses for real
      // profit instead of expensing raw-material purchases by month bought.
      const stockForCost = await getStock();
      for (const item of cartItems) {
        const itemTotal = item.quantity * item.unitPrice;
        const amountPaid = paymentMethod !== 'credit' ? itemTotal : 0;
        const { stockId, amount } = resolveStockTarget(item);
        const avgCost = stockForCost.find((s) => s.id === stockId)?.avgCost ?? 0;
        await addSale({
          date: toDateString(),
          clientName: clientQuery.trim(),
          product: item.product,
          productType: item.productType,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: itemTotal,
          amountPaid,
          paymentMethod,
          costAmount: avgCost * amount,
        });
      }
      await deductStock(buildDeductions());
      await load();
      resetForm();
      Alert.alert('Succès', `${cartItems.length} article${cartItems.length > 1 ? 's' : ''} enregistré${cartItems.length > 1 ? 's' : ''}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!clientQuery.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir un nom de client.');
      return;
    }
    if (cartItems.length === 0) {
      Alert.alert('Erreur', 'Ajoutez au moins un produit au panier.');
      return;
    }

    const shortfalls = await checkStockAvailability(buildDeductions());
    if (shortfalls.length > 0) {
      const detail = shortfalls
        .map((s) => `${s.name} : ${s.available} ${s.unit} dispo, ${s.needed} ${s.unit} nécessaire${s.needed > 1 ? 's' : ''}`)
        .join('\n');
      Alert.alert(
        'Stock insuffisant',
        `${detail}\n\nVendre quand même ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Vendre quand même', style: 'destructive', onPress: finalizeSale },
        ]
      );
      return;
    }

    await finalizeSale();
  };

  const handleMarkPaid = async (sale: Sale) => {
    await updateSale(sale.id, { amountPaid: sale.totalAmount });
    await load();
    setDetailSale(null);
    Alert.alert('Succès', 'Vente marquée comme payée.');
  };

  const openEdit = (sale: Sale) => {
    setEditingSale(sale);
    setEditForm({
      clientName: sale.clientName,
      quantity: sale.quantity,
      unitPrice: sale.unitPrice,
      paymentMethod: sale.paymentMethod,
    });
    setDetailSale(null);
  };

  const handleUpdate = async () => {
    if (!editingSale || !editForm) return;
    setSaving(true);
    try {
      const newTotal = editForm.quantity * editForm.unitPrice;
      const amountPaid = editForm.paymentMethod !== 'credit' ? newTotal : (editingSale.amountPaid ?? 0);
      await updateSale(editingSale.id, {
        clientName: editForm.clientName,
        quantity: editForm.quantity,
        unitPrice: editForm.unitPrice,
        totalAmount: newTotal,
        amountPaid,
        paymentMethod: editForm.paymentMethod,
      });
      await load();
      setEditingSale(null);
      setEditForm(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (sale: Sale) => {
    setDetailSale(null);
    setDeleteTarget(sale);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.segmentRow}>
        {(['new', 'history'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.segment, tab === t && styles.segmentActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
              {t === 'new' ? 'Nouvelle vente' : 'Historique'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'new' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.form}>

            {/* Client */}
            <Text style={styles.label}>Client</Text>
            <View style={styles.autocompleteWrap}>
              <TextInput
                style={styles.input}
                placeholder="Nom ou numéro de téléphone"
                value={clientQuery}
                onChangeText={(t) => { setClientQuery(t); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => {
                  if (!blurSuppressedRef.current) setShowSuggestions(false);
                  blurSuppressedRef.current = false;
                }, 150)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <View style={styles.suggestions}>
                  {suggestions.map((client) => (
                    <TouchableOpacity
                      key={client.id}
                      style={styles.suggestionItem}
                      onPressIn={() => { blurSuppressedRef.current = true; }}
                      onPress={() => { setClientQuery(client.name); setShowSuggestions(false); }}
                    >
                      <Text style={styles.suggestionText}>{client.name}</Text>
                      {client.phone ? (
                        <Text style={styles.suggestionPhone}>{client.phone}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Product type */}
            <Text style={styles.label}>Type de produit</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, productMode === 'flavor' && styles.modeBtnActive]}
                onPress={() => handleModeChange('flavor')}
              >
                <Text style={[styles.modeBtnText, productMode === 'flavor' && { color: palette.white }]}>
                  Unités individuelles
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, productMode === 'bulk' && styles.modeBtnActive]}
                onPress={() => handleModeChange('bulk')}
              >
                <Text style={[styles.modeBtnText, productMode === 'bulk' && { color: palette.white }]}>
                  Lots
                </Text>
              </TouchableOpacity>
            </View>

            {productMode === 'flavor' ? (
              <>
                <Text style={styles.label}>Saveur</Text>
                {flavors.length === 0 ? (
                  <Text style={styles.emptyHint}>Aucune saveur. Allez dans Menu &gt; Saveurs pour en créer.</Text>
                ) : (
                  <View style={styles.productsRow}>
                    {flavors.map((f) => (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.productCard, selectedFlavorId === f.id && styles.productCardSelected]}
                        onPress={() => handleSelectFlavor(f)}
                      >
                        <Text style={[styles.productLabel, selectedFlavorId === f.id && { color: palette.white }]}>
                          {f.label}
                        </Text>
                        <Text style={[styles.productPrice, selectedFlavorId === f.id && { color: 'rgba(255,255,255,0.8)' }]}>
                          {formatGNF(f.defaultPrice)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.label}>Lot</Text>
                {bulks.length === 0 ? (
                  <Text style={styles.emptyHint}>Aucun lot. Allez dans Menu &gt; Vrac pour en créer.</Text>
                ) : (
                  <View style={styles.productsRow}>
                    {bulks.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        style={[styles.productCard, selectedBulkId === b.id && styles.productCardSelected]}
                        onPress={() => handleSelectBulk(b)}
                      >
                        <Text style={[styles.productLabel, selectedBulkId === b.id && { color: palette.white }]}>
                          {b.name}
                        </Text>
                        <Text style={[styles.productPrice, selectedBulkId === b.id && { color: 'rgba(255,255,255,0.8)' }]}>
                          {b.bagCount} unités · {formatGNF(b.unitPrice)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>Quantité</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity((q) => Math.max(1, q - 1))}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.qtyInput}
                keyboardType="numeric"
                value={String(quantity)}
                onChangeText={(t) => setQuantity(Math.max(1, parseInt(t) || 1))}
              />
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity((q) => q + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Prix unitaire (GNF)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(unitPrice)}
              onChangeText={(t) => setUnitPrice(parseInt(t) || 0)}
            />

            <View style={styles.totalBox}>
              <Text style={styles.totalText}>{formatGNF(currentItemTotal)}</Text>
            </View>

            {/* Add to cart button */}
            <TouchableOpacity style={styles.addToCartBtn} onPress={handleAddToCart}>
              <Ionicons name="add-circle-outline" size={20} color={palette.moss} />
              <Text style={styles.addToCartText}>Ajouter au panier</Text>
            </TouchableOpacity>

            {/* Cart */}
            {cartItems.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 20 }]}>
                  Panier · {cartItems.length} article{cartItems.length > 1 ? 's' : ''}
                </Text>
                {cartItems.map((item) => (
                  <View key={item.id} style={styles.cartRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartItemLabel}>{item.productLabel}</Text>
                      <Text style={styles.cartItemMeta}>{item.quantity}× · {formatGNF(item.unitPrice)}</Text>
                    </View>
                    <Text style={styles.cartItemTotal}>{formatGNF(item.quantity * item.unitPrice)}</Text>
                    <TouchableOpacity style={styles.cartRemoveBtn} onPress={() => handleRemoveFromCart(item.id)}>
                      <Ionicons name="trash-outline" size={18} color={palette.critical} />
                    </TouchableOpacity>
                  </View>
                ))}

                <View style={styles.cartGrandTotal}>
                  <Text style={styles.cartGrandLabel}>Total de la vente</Text>
                  <Text style={styles.cartGrandValue}>{formatGNF(cartTotal)}</Text>
                </View>

                <Text style={styles.label}>Mode de paiement</Text>
                <View style={styles.paymentRow}>
                  {(Object.keys(PAYMENT_LABELS) as Sale['paymentMethod'][]).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.payBtn, paymentMethod === m && { backgroundColor: PAYMENT_COLORS[m] }]}
                      onPress={() => setPaymentMethod(m)}
                    >
                      <Text style={[styles.payBtnText, paymentMethod === m && { color: palette.white }]}>
                        {PAYMENT_LABELS[m]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, saving && { opacity: 0.6 }]}
                  onPress={handleFinalize}
                  disabled={saving}
                >
                  <Text style={styles.submitText}>
                    {saving ? 'Enregistrement…' : `Finaliser · ${formatGNF(cartTotal)}`}
                  </Text>
                </TouchableOpacity>
              </>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ListEmptyComponent={<Text style={styles.empty}>Aucune vente enregistrée.</Text>}
          renderItem={({ item }) => {
            const debt = saleDebt(item);
            return (
              <TouchableOpacity style={styles.saleRow} onPress={() => setDetailSale(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.saleClient}>{item.clientName}</Text>
                  <Text style={styles.saleMeta}>
                    {getProductLabel(item)} · {item.quantity}× · {formatDate(item.date)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.saleTotal}>{formatGNF(item.totalAmount)}</Text>
                  <View style={[styles.badge, { backgroundColor: (PAYMENT_COLORS[item.paymentMethod] ?? palette.muted) + '22' }]}>
                    <Text style={[styles.badgeText, { color: PAYMENT_COLORS[item.paymentMethod] ?? palette.muted }]}>
                      {PAYMENT_LABELS[item.paymentMethod] ?? item.paymentMethod}
                    </Text>
                  </View>
                  {debt > 0 && (
                    <Text style={styles.debtBadge}>Doit {formatGNF(debt)}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Detail modal */}
      <AppModal visible={!!detailSale} onClose={() => setDetailSale(null)} title="Détail de la vente">
        {detailSale && (
          <>
            <DetailRow label="Client" value={detailSale.clientName} />
            <DetailRow label="Produit" value={getProductLabel(detailSale)} />
            <DetailRow label="Quantité" value={`${detailSale.quantity}×`} />
            <DetailRow label="Prix unitaire" value={formatGNF(detailSale.unitPrice)} />
            <DetailRow label="Total" value={formatGNF(detailSale.totalAmount)} />
            <DetailRow label="Paiement" value={PAYMENT_LABELS[detailSale.paymentMethod] ?? detailSale.paymentMethod} />
            {detailSale.paymentMethod === 'credit' && (
              <DetailRow
                label="Montant dû"
                value={formatGNF(saleDebt(detailSale))}
                valueStyle={{ color: saleDebt(detailSale) > 0 ? palette.critical : palette.moss }}
              />
            )}
            <DetailRow label="Date" value={formatDate(detailSale.date)} />
            {detailSale.paymentMethod === 'credit' && saleDebt(detailSale) > 0 && (
              <TouchableOpacity
                style={styles.markPaidBtn}
                onPress={() => handleMarkPaid(detailSale)}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={palette.moss} />
                <Text style={styles.markPaidText}>Marquer comme payé</Text>
              </TouchableOpacity>
            )}
            <View style={styles.detailActions}>
              <TouchableOpacity style={styles.editDetailBtn} onPress={() => openEdit(detailSale)}>
                <Ionicons name="pencil-outline" size={16} color={palette.moss} />
                <Text style={styles.editDetailText}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteDetailBtn} onPress={() => handleDelete(detailSale)}>
                <Ionicons name="trash-outline" size={16} color={palette.critical} />
                <Text style={styles.deleteDetailText}>Supprimer</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </AppModal>

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteSale(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer cette vente ?"
        message={deleteTarget ? `${deleteTarget.clientName} — ${formatGNF(deleteTarget.totalAmount)}` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Edit modal */}
      <AppModal visible={!!editingSale} onClose={() => setEditingSale(null)} title="Modifier la vente">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {editForm && (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.editLabel}>Client</Text>
              <TextInput
                style={styles.editInput}
                value={editForm.clientName}
                onChangeText={(v) => setEditForm((f) => f ? { ...f, clientName: v } : f)}
              />
              <Text style={styles.editLabel}>Quantité</Text>
              <TextInput
                style={styles.editInput}
                keyboardType="numeric"
                value={String(editForm.quantity)}
                onChangeText={(v) => setEditForm((f) => f ? { ...f, quantity: parseInt(v) || 1 } : f)}
              />
              <Text style={styles.editLabel}>Prix unitaire (GNF)</Text>
              <TextInput
                style={styles.editInput}
                keyboardType="numeric"
                value={String(editForm.unitPrice)}
                onChangeText={(v) => setEditForm((f) => f ? { ...f, unitPrice: parseInt(v) || 0 } : f)}
              />
              <Text style={styles.editLabel}>Mode de paiement</Text>
              <View style={styles.paymentRow}>
                {(Object.keys(PAYMENT_LABELS) as Sale['paymentMethod'][]).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.payBtn, editForm.paymentMethod === m && { backgroundColor: PAYMENT_COLORS[m] }]}
                    onPress={() => setEditForm((f) => f ? { ...f, paymentMethod: m } : f)}
                  >
                    <Text style={[styles.payBtnText, editForm.paymentMethod === m && { color: palette.white }]}>
                      {PAYMENT_LABELS[m]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.totalBox, { marginTop: 12 }]}>
                Total : {formatGNF(editForm.quantity * editForm.unitPrice)}
              </Text>
            </ScrollView>
          )}
          <View style={styles.modalActionsRow}>
            <Button label="Annuler" variant="ghost" onPress={() => setEditingSale(null)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleUpdate} loading={saving} style={{ flex: 1 }} />
          </View>
        </KeyboardAvoidingView>
      </AppModal>
    </View>
  );
}

function DetailRow({
  label, value, valueStyle,
}: {
  label: string; value: string; valueStyle?: object;
}) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  segmentRow: {
    flexDirection: 'row', backgroundColor: palette.card,
    borderBottomWidth: 1, borderColor: palette.line,
  },
  segment: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  segmentActive: { borderBottomWidth: 2, borderColor: palette.moss },
  segmentText: { fontSize: 15, color: palette.muted, fontWeight: '500' },
  segmentTextActive: { color: palette.moss, fontWeight: '600' },
  form: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: palette.card, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  autocompleteWrap: { position: 'relative', zIndex: 10 },
  suggestions: {
    position: 'absolute', top: 52, left: 0, right: 0,
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
    zIndex: 20,
  },
  suggestionItem: { padding: 14, borderBottomWidth: 1, borderColor: palette.line },
  suggestionText: { fontSize: 15, color: palette.ink },
  suggestionPhone: { fontSize: 12, color: palette.muted, marginTop: 2 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: palette.ink },
  emptyHint: { fontSize: 13, color: palette.muted, fontStyle: 'italic' },
  productsRow: { gap: 8 },
  productCard: {
    backgroundColor: palette.card, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14,
  },
  productCardSelected: { backgroundColor: palette.moss, borderColor: palette.moss },
  productLabel: { fontSize: 15, fontWeight: '600', color: palette.ink },
  productPrice: { fontSize: 13, color: palette.muted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: palette.card,
    borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 22, color: palette.moss, fontWeight: '600' },
  qtyInput: {
    flex: 1, backgroundColor: palette.card, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 12, fontSize: 18, textAlign: 'center', color: palette.ink,
  },
  totalBox: {
    backgroundColor: palette.mossSoft, borderRadius: 12, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: palette.moss + '40',
    fontSize: 16, fontWeight: '600', color: palette.moss, textAlign: 'center',
  } as any,
  totalText: { fontSize: 24, fontWeight: '600', color: palette.moss },
  addToCartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, height: 52, marginTop: 4,
    backgroundColor: palette.mossSoft, borderWidth: 1, borderColor: palette.moss + '40',
  },
  addToCartText: { fontSize: 16, fontWeight: '600', color: palette.moss },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: palette.card,
    borderRadius: 12, borderWidth: 1, borderColor: palette.line, padding: 14, gap: 10,
  },
  cartItemLabel: { fontSize: 14, fontWeight: '600', color: palette.ink },
  cartItemMeta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  cartItemTotal: { fontSize: 14, fontWeight: '600', color: palette.ink },
  cartRemoveBtn: { padding: 4 },
  cartGrandTotal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: palette.mossSoft, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: palette.moss + '40', marginTop: 4,
  },
  cartGrandLabel: { fontSize: 15, fontWeight: '600', color: palette.moss },
  cartGrandValue: { fontSize: 22, fontWeight: '700', color: palette.moss },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payBtn: {
    flex: 1, minWidth: '30%', height: 52, borderRadius: 12,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  payBtnText: { fontSize: 14, fontWeight: '600', color: palette.ink },
  submitBtn: {
    backgroundColor: palette.moss, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  saleRow: {
    flexDirection: 'row', backgroundColor: palette.card, borderRadius: 12,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  saleClient: { fontSize: 15, fontWeight: '600', color: palette.ink },
  saleMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  saleTotal: { fontSize: 15, fontWeight: '600', color: palette.ink },
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  debtBadge: { fontSize: 11, color: palette.critical, fontWeight: '600' },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderColor: palette.line,
  },
  detailLabel: { fontSize: 14, color: palette.muted },
  detailValue: { fontSize: 14, fontWeight: '600', color: palette.ink },
  markPaidBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.mossSoft, borderRadius: 10, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: palette.moss + '40',
  },
  markPaidText: { fontSize: 15, fontWeight: '600', color: palette.moss },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  editDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: palette.mossSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  editDetailText: { fontSize: 14, fontWeight: '600', color: palette.moss },
  deleteDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: palette.criticalSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  deleteDetailText: { fontSize: 14, fontWeight: '600', color: palette.critical },
  editLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  editInput: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  modalActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
