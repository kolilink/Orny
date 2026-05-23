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
import { Sale, ProductFlavor, BulkProduct, Client, saleDebt } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import { getFactoryId } from '../../store/context';

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

const PAYMENT_LABELS: Record<Sale['paymentMethod'], string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

const PAYMENT_COLORS: Record<Sale['paymentMethod'], string> = {
  cash: '#1D9E75',
  orange_money: '#EF9F27',
  credit: '#E24B4A',
};

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
  }, []);

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

  const handleFinalize = async () => {
    if (!clientQuery.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir un nom de client.');
      return;
    }
    if (cartItems.length === 0) {
      Alert.alert('Erreur', 'Ajoutez au moins un produit au panier.');
      return;
    }
    setSaving(true);
    try {
      await upsertClient(clientQuery.trim());
      for (const item of cartItems) {
        const itemTotal = item.quantity * item.unitPrice;
        const amountPaid = paymentMethod !== 'credit' ? itemTotal : 0;
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
        });
      }
      await load();
      resetForm();
      Alert.alert('Succès', `${cartItems.length} article${cartItems.length > 1 ? 's' : ''} enregistré${cartItems.length > 1 ? 's' : ''}.`);
    } finally {
      setSaving(false);
    }
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
                <Text style={[styles.modeBtnText, productMode === 'flavor' && { color: '#fff' }]}>
                  Unités individuelles
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, productMode === 'bulk' && styles.modeBtnActive]}
                onPress={() => handleModeChange('bulk')}
              >
                <Text style={[styles.modeBtnText, productMode === 'bulk' && { color: '#fff' }]}>
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
                        <Text style={[styles.productLabel, selectedFlavorId === f.id && { color: '#fff' }]}>
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
                        <Text style={[styles.productLabel, selectedBulkId === b.id && { color: '#fff' }]}>
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
              <Ionicons name="add-circle-outline" size={20} color={C.primary} />
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
                      <Ionicons name="trash-outline" size={18} color={C.red} />
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
                      <Text style={[styles.payBtnText, paymentMethod === m && { color: '#fff' }]}>
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
                  <View style={[styles.badge, { backgroundColor: (PAYMENT_COLORS[item.paymentMethod] ?? C.muted) + '22' }]}>
                    <Text style={[styles.badgeText, { color: PAYMENT_COLORS[item.paymentMethod] ?? C.muted }]}>
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
      <Modal visible={!!detailSale} animationType="slide" transparent onRequestClose={() => setDetailSale(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Détail de la vente</Text>
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
                    valueStyle={{ color: saleDebt(detailSale) > 0 ? C.red : C.primary }}
                  />
                )}
                <DetailRow label="Date" value={formatDate(detailSale.date)} />
                {detailSale.paymentMethod === 'credit' && saleDebt(detailSale) > 0 && (
                  <TouchableOpacity
                    style={styles.markPaidBtn}
                    onPress={() => handleMarkPaid(detailSale)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={18} color={C.primary} />
                    <Text style={styles.markPaidText}>Marquer comme payé</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.detailActions}>
                  <TouchableOpacity style={styles.editDetailBtn} onPress={() => openEdit(detailSale)}>
                    <Ionicons name="pencil-outline" size={16} color={C.primary} />
                    <Text style={styles.editDetailText}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteDetailBtn} onPress={() => handleDelete(detailSale)}>
                    <Ionicons name="trash-outline" size={16} color={C.red} />
                    <Text style={styles.deleteDetailText}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setDetailSale(null)}>
              <Text style={styles.closeBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete confirm modal */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer cette vente ?</Text>
            <Text style={styles.confirmSub}>
              {deleteTarget ? `${deleteTarget.clientName} — ${formatGNF(deleteTarget.totalAmount)}` : ''}
            </Text>
            <TouchableOpacity
              style={styles.confirmDeleteBtn}
              onPress={async () => {
                if (!deleteTarget) return;
                await deleteSale(deleteTarget.id);
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

      {/* Edit modal */}
      <Modal visible={!!editingSale} animationType="slide" transparent onRequestClose={() => setEditingSale(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Modifier la vente</Text>
              {editForm && (
                <ScrollView>
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
                        <Text style={[styles.payBtnText, editForm.paymentMethod === m && { color: '#fff' }]}>
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
                <TouchableOpacity style={styles.cancelBtn2} onPress={() => setEditingSale(null)}>
                  <Text style={styles.cancelText2}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn2, saving && { opacity: 0.6 }]}
                  onPress={handleUpdate}
                  disabled={saving}
                >
                  <Text style={styles.confirmText2}>{saving ? '…' : 'Enregistrer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DetailRow({
  label, value, valueStyle,
}: {
  label: string; value: string; valueStyle?: object;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  segmentRow: {
    flexDirection: 'row', backgroundColor: C.card,
    borderBottomWidth: 1, borderColor: C.border,
  },
  segment: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  segmentActive: { borderBottomWidth: 2, borderColor: C.primary },
  segmentText: { fontSize: 15, color: C.muted, fontWeight: '500' },
  segmentTextActive: { color: C.primary, fontWeight: '600' },
  form: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 14, fontSize: 16, color: C.text,
  },
  autocompleteWrap: { position: 'relative', zIndex: 10 },
  suggestions: {
    position: 'absolute', top: 52, left: 0, right: 0,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
    zIndex: 20,
  },
  suggestionItem: { padding: 14, borderBottomWidth: 1, borderColor: '#F0F0EE' },
  suggestionText: { fontSize: 15, color: C.text },
  suggestionPhone: { fontSize: 12, color: C.muted, marginTop: 2 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: C.text },
  emptyHint: { fontSize: 13, color: C.muted, fontStyle: 'italic' },
  productsRow: { gap: 8 },
  productCard: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 14,
  },
  productCardSelected: { backgroundColor: C.primary, borderColor: C.primary },
  productLabel: { fontSize: 15, fontWeight: '600', color: C.text },
  productPrice: { fontSize: 13, color: C.muted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 22, color: C.primary, fontWeight: '600' },
  qtyInput: {
    flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 12, fontSize: 18, textAlign: 'center', color: C.text,
  },
  totalBox: {
    backgroundColor: '#F0FBF7', borderRadius: 12, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#C7EDE3',
    fontSize: 16, fontWeight: '600', color: C.primary, textAlign: 'center',
  } as any,
  totalText: { fontSize: 24, fontWeight: '600', color: C.primary },
  addToCartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, height: 52, marginTop: 4,
    backgroundColor: '#E8F6F0', borderWidth: 1, borderColor: '#C7EDE3',
  },
  addToCartText: { fontSize: 16, fontWeight: '600', color: C.primary },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10,
  },
  cartItemLabel: { fontSize: 14, fontWeight: '600', color: C.text },
  cartItemMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  cartItemTotal: { fontSize: 14, fontWeight: '600', color: C.text },
  cartRemoveBtn: { padding: 4 },
  cartGrandTotal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#F0FBF7', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#C7EDE3', marginTop: 4,
  },
  cartGrandLabel: { fontSize: 15, fontWeight: '600', color: C.primary },
  cartGrandValue: { fontSize: 22, fontWeight: '700', color: C.primary },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payBtn: {
    flex: 1, minWidth: '30%', height: 52, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  payBtnText: { fontSize: 14, fontWeight: '600', color: C.text },
  submitBtn: {
    backgroundColor: C.primary, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  saleRow: {
    flexDirection: 'row', backgroundColor: C.card, borderRadius: 12,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  saleClient: { fontSize: 15, fontWeight: '600', color: C.text },
  saleMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  saleTotal: { fontSize: 15, fontWeight: '600', color: C.text },
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  debtBadge: { fontSize: 11, color: C.red, fontWeight: '600' },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '90%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F0F0EE',
  },
  detailLabel: { fontSize: 14, color: C.muted },
  detailValue: { fontSize: 14, fontWeight: '600', color: C.text },
  markPaidBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#E8F6F0', borderRadius: 10, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: '#C7EDE3',
  },
  markPaidText: { fontSize: 15, fontWeight: '600', color: C.primary },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  editDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: '#E8F6F0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  editDetailText: { fontSize: 14, fontWeight: '600', color: C.primary },
  deleteDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: '#FDECEA',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  deleteDetailText: { fontSize: 14, fontWeight: '600', color: C.red },
  closeBtn: {
    backgroundColor: C.bg, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  closeBtnText: { fontSize: 16, color: C.text, fontWeight: '600' },
  editLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 4 },
  editInput: {
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 14, fontSize: 16, color: C.text,
  },
  modalActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn2: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelText2: { fontSize: 16, color: C.muted, fontWeight: '600' },
  confirmBtn2: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText2: { fontSize: 16, color: '#FFFFFF', fontWeight: '700' },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24,
  },
  confirmBox: {
    backgroundColor: C.card, borderRadius: 16, padding: 24,
  },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A18', textAlign: 'center', marginBottom: 6 },
  confirmSub: { fontSize: 14, color: C.muted, textAlign: 'center', marginBottom: 20 },
  confirmDeleteBtn: {
    backgroundColor: C.red, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  confirmDeleteText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  confirmCancelBtn: {
    borderRadius: 12, height: 52, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmCancelText: { fontSize: 16, color: C.muted, fontWeight: '600' },
});
