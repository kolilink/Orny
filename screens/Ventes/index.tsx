import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { addSale } from '../../store/sales';
import { getClients, upsertClient, syncClientsFromSupabase } from '../../store/clients';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, syncBulksFromSupabase } from '../../store/bulks';
import { checkStockAvailability, deductStock, ensureStockItem, getStock, syncStockFromSupabase } from '../../store/stock';
import { Sale, ProductFlavor, BulkProduct, Client, StockItem } from '../../types';
import { formatGNF, formatNumber } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import { getFactoryId } from '../../store/context';
import { stockSeverity } from '../../utils/stockAlerts';
import { ClientPicker } from '../../components/ClientPicker';
import { hapticTap, hapticSuccess, hapticSelect } from '../../utils/haptics';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, CountUpNumber, MoneyInput, PressableScale, FadeSlideIn, Text } from '../../components/ui';

const PAYMENT_LABELS: Record<Sale['paymentMethod'], string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

// orange_money references Orange Money's own real-world brand color
// deliberately, not the app's caution/critical tokens — see the same note
// in screens/Reports/index.tsx and screens/Ventes/History.tsx.
const ORANGE_MONEY_BRAND = '#EF9F27';

// credit is a payment *method*, not itself a problem — see the identical
// note in screens/Ventes/History.tsx.
const makePaymentColors = (palette: Palette): Record<Sale['paymentMethod'], string> => ({
  cash: palette.moss,
  orange_money: ORANGE_MONEY_BRAND,
  credit: palette.violet,
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

// One product-grid tile, extracted and memoized so that typing in the
// client field, ticking a cart quantity stepper, or any other unrelated
// state change on this screen no longer re-renders every card in the grid
// (previously all inline in one .map(), so every keystroke re-created every
// card's element and its PressableScale/FadeSlideIn closures). Only takes
// primitive props (plus a stable `onTap`, see handleTapProduct's own
// useCallback) so React.memo's default shallow comparison actually skips
// re-rendering a card whose own data hasn't changed.
type ProductCardProps = {
  mode: ProductMode;
  id: string;
  label: string;
  subtitle: string;
  price: number;
  badgeCount: number;
  index: number;
  tinted?: boolean;
  stockLine?: { label: string; severity: 'critical' | 'low' | 'ok' };
  onTap: (mode: ProductMode, id: string, label: string, price: number) => void;
  styles: ReturnType<typeof makeStyles>;
};

const ProductCard = React.memo(function ProductCard({
  mode, id, label, subtitle, price, badgeCount, index, tinted, stockLine, onTap, styles,
}: ProductCardProps) {
  return (
    <FadeSlideIn index={index} style={styles.productCardSlot}>
      <PressableScale
        style={[styles.productCard, tinted && styles.productCardBulk]}
        onPress={() => onTap(mode, id, label, price)}
      >
        <Text style={styles.productLabel}>{label}</Text>
        <Text style={styles.productPrice}>{subtitle}</Text>
        {stockLine && (
          <Text
            style={[
              styles.productStock,
              stockLine.severity === 'low' && styles.productStockLow,
              stockLine.severity === 'critical' && styles.productStockOut,
            ]}
          >
            {stockLine.label}
          </Text>
        )}
        {badgeCount > 0 && (
          <View style={styles.productBadge}>
            <Text style={styles.productBadgeText}>{badgeCount}</Text>
          </View>
        )}
      </PressableScale>
    </FadeSlideIn>
  );
});

// The Ventes tab is purely the sell action — nothing to read, only products
// to tap and a cart to check out. Sales history (list, detail, edit, delete)
// lives on its own screen now (screens/Ventes/History.tsx), reached from
// Plus like Dépenses/Investisseurs, not from a tab inside this flow.
export default function VentesScreen() {
  const { palette } = useTheme();
  // Memoized so its identity is stable across renders that don't change
  // palette — ProductCard below is React.memo'd specifically to skip
  // re-rendering the whole product grid on every keystroke/cart tick, and
  // that only works if the `styles` object it's compared against isn't a
  // brand-new reference every single render.
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const PAYMENT_COLORS = makePaymentColors(palette);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);
  const [stock, setStockState] = useState<StockItem[]>([]);

  const [clientQuery, setClientQuery] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Quick per-line price override — deliberately not part of the default
  // tap-to-add path (see the file-level note below the component), reached
  // only by tapping a cart row's own price.
  const [priceEditTarget, setPriceEditTarget] = useState<CartItem | null>(null);
  const [priceEditValue, setPriceEditValue] = useState('');

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

  // Cache-first: render instantly from whatever's already on-device (no
  // waiting on the network before a single product shows up), then sync in
  // the background and render again once fresh data actually arrives — the
  // same shape AuthContext's own cold-start bootstrap already proved out,
  // applied consistently here instead of blocking the UI on the sync first.
  const load = useCallback(async () => {
    const [cls, fl, bk, st] = await Promise.all([getClients(), getFlavors(), getBulks(), getStock()]);
    setAllClients(cls);
    setFlavorsState(fl);
    setBulksState(bk);
    setStockState(st);

    await Promise.all([syncClientsFromSupabase(), syncFlavorsFromSupabase(), syncBulksFromSupabase(), syncStockFromSupabase()]);
    const [freshCls, freshFl, freshBk, freshSt] = await Promise.all([getClients(), getFlavors(), getBulks(), getStock()]);
    setAllClients(freshCls);
    setFlavorsState(freshFl);
    setBulksState(freshBk);
    setStockState(freshSt);

    // Self-heal: flavors/standalone bulks created before stock tracking
    // existed have no stock row yet — back-fill them at 0 so they show up
    // and can be topped up, instead of silently having nothing to deduct.
    await Promise.all([
      ...freshFl.map((f) => ensureStockItem(f.id, f.label, 'sachet')),
      ...freshBk.filter((b) => !b.flavorId).map((b) => ensureStockItem(b.id, b.name, 'unité')),
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

  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const resetForm = () => {
    setClientQuery('');
    setPaymentMethod('cash');
    setCartItems([]);
    AsyncStorage.removeItem(draftKey);
  };

  // How many of this exact product are already in the cart — shown as a
  // small badge on its card, the only feedback a tap needs (no separate
  // "added!" toast, no page transition).
  const cartQtyFor = (mode: ProductMode, id: string) =>
    cartItems.filter((it) => it.productType === mode && it.product === id).reduce((s, it) => s + it.quantity, 0);

  // Real pieces remaining, shown right on the card — a seller taps to sell,
  // they should see if they're about to run out before promising it to a
  // customer, not discover it at checkout via a "stock insuffisant" alert.
  const stockFor = (id: string): number => stock.find((s) => s.id === id)?.currentLevel ?? 0;

  // Tapping a product IS adding it — no separate quantity/price step, no
  // "Ajouter au panier" button. A repeat tap on the same product (at its
  // current, unedited price) just bumps that line's quantity by one; a
  // price that's been overridden via openPriceEdit stays its own line so a
  // discounted unit and a full-price one don't silently merge.
  // useCallback with no deps — the body only ever reads/writes cartItems via
  // the functional setState form below, so it never needs to close over
  // fresh render-scope values. A stable reference here is what lets
  // ProductCard's React.memo below actually skip re-rendering on unrelated
  // state changes (a new inline arrow function every render would defeat it
  // regardless of memo, since props would never compare equal).
  const handleTapProduct = useCallback((mode: ProductMode, id: string, label: string, price: number) => {
    hapticTap();
    setCartItems((prev) => {
      const idx = prev.findIndex((it) => it.productType === mode && it.product === id && it.unitPrice === price);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, {
        id: Date.now().toString() + String(Math.random()),
        productType: mode, product: id, productLabel: label, quantity: 1, unitPrice: price,
      }];
    });
  }, []);

  const handleUpdateQty = (id: string, qty: number) => {
    if (qty <= 0) {
      handleRemoveFromCart(id);
      return;
    }
    setCartItems((prev) => prev.map((it) => (it.id === id ? { ...it, quantity: qty } : it)));
  };

  const handleRemoveFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  const openPriceEdit = (item: CartItem) => {
    setPriceEditTarget(item);
    setPriceEditValue(String(item.unitPrice));
  };

  const handleSavePriceEdit = () => {
    if (!priceEditTarget) return;
    const newPrice = parseInt(priceEditValue.replace(/\s/g, ''), 10) || 0;
    setCartItems((prev) => prev.map((it) => (it.id === priceEditTarget.id ? { ...it, unitPrice: newPrice } : it)));
    setPriceEditTarget(null);
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
          createdBy: user?.id,
        });
      }
      await deductStock(buildDeductions());
      await load();
      resetForm();
      hapticSuccess();
      Alert.alert('Succès', `${cartItems.length} produit${cartItems.length > 1 ? 's' : ''} enregistré${cartItems.length > 1 ? 's' : ''}.`);
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vendre</Text>
        {cartItems.length > 0 && (
          <TouchableOpacity onPress={resetForm} hitSlop={8}>
            <Text style={styles.headerClear}>Vider</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

          {/* Two fixed columns, not one wrapping grid — simple products
              (Saveurs) always on the left, lots (green-tinted) always on
              the right, so the split reads at a glance instead of only
              being told apart by a tinted card color you notice mid-scan.
              A lot is still told apart from a simple unit by that same
              tinted background, on top of the column it's in. Tap adds
              directly to the cart below. */}
          {flavors.length === 0 && bulks.length === 0 ? (
            <Text style={styles.emptyHint}>Aucun produit. Allez dans Menu &gt; Saveurs ou Lots pour en créer.</Text>
          ) : (
            <View style={styles.productsGrid}>
              <View style={styles.productsColumn}>
                {flavors.map((f, i) => {
                  const stockItem = stock.find((s) => s.id === f.id);
                  const level = stockFor(f.id);
                  const severity = stockSeverity(level, stockItem?.alertThreshold ?? 0);
                  return (
                    <ProductCard
                      key={f.id}
                      mode="flavor"
                      id={f.id}
                      label={f.label}
                      subtitle={formatNumber(f.defaultPrice)}
                      price={f.defaultPrice}
                      badgeCount={cartQtyFor('flavor', f.id)}
                      index={i}
                      stockLine={{ label: `${level} en stock`, severity }}
                      onTap={handleTapProduct}
                      styles={styles}
                    />
                  );
                })}
              </View>
              <View style={styles.productsColumn}>
                {bulks.map((b, i) => (
                  <ProductCard
                    key={b.id}
                    mode="bulk"
                    id={b.id}
                    label={b.name}
                    subtitle={`${b.bagCount} pcs · ${formatNumber(b.unitPrice)}`}
                    price={b.unitPrice}
                    badgeCount={cartQtyFor('bulk', b.id)}
                    index={flavors.length + i}
                    tinted
                    onTap={handleTapProduct}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Everything below only matters once there's something to sell —
              cart, client, payment method, and the finalize button all
              appear together at the point of checkout, not scattered
              above the product picker. */}
          {cartItems.length > 0 && (
            <>
              <Text style={[styles.label, { marginTop: 20 }]}>
                Panier · {cartItems.length} produit{cartItems.length > 1 ? 's' : ''}
              </Text>
              <View style={styles.cartList}>
                {cartItems.map((item, i) => (
                  <React.Fragment key={item.id}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <View style={styles.cartRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cartItemLabel}>{item.productLabel}</Text>
                        <TouchableOpacity onPress={() => openPriceEdit(item)}>
                          <Text style={styles.cartItemPrice}>{formatNumber(item.unitPrice)} / pcs</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.cartQtyStepper}>
                        <TouchableOpacity style={styles.cartQtyBtn} onPress={() => handleUpdateQty(item.id, item.quantity - 1)}>
                          <Text style={styles.cartQtyBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.cartQtyValue}>{item.quantity}</Text>
                        <TouchableOpacity style={styles.cartQtyBtn} onPress={() => handleUpdateQty(item.id, item.quantity + 1)}>
                          <Text style={styles.cartQtyBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.cartItemTotal}>{formatNumber(item.quantity * item.unitPrice)}</Text>
                      <TouchableOpacity style={styles.cartRemoveBtn} onPress={() => handleRemoveFromCart(item.id)}>
                        <Ionicons name="trash-outline" size={16} color={palette.critical} />
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ))}
              </View>

              <View style={styles.cartGrandTotal}>
                <Text style={styles.cartGrandLabel}>Total de la vente</Text>
                <CountUpNumber value={cartTotal} formatter={formatGNF} duration={250} style={styles.cartGrandValue} />
              </View>

              {/* Client — search existing clients by name/phone, or create
                  one on the spot when a typed phone number matches nobody
                  (see components/ClientPicker.tsx). */}
              <ClientPicker
                clients={allClients}
                value={clientQuery}
                onChangeText={setClientQuery}
                onClientCreated={(c) => setAllClients((prev) => [c, ...prev])}
              />

              <Text style={styles.label}>Mode de paiement</Text>
              <View style={styles.paymentRow}>
                {(Object.keys(PAYMENT_LABELS) as Sale['paymentMethod'][]).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.payBtn, paymentMethod === m && { backgroundColor: PAYMENT_COLORS[m] }]}
                    onPress={() => { hapticSelect(); setPaymentMethod(m); }}
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

      {/* Per-line price override — the one deliberate escape hatch from the
          tap-to-add default price (a real customer discount, a rounding
          adjustment), reached only by tapping a cart row's own price. */}
      <AppModal visible={!!priceEditTarget} onClose={() => setPriceEditTarget(null)} title="Modifier le prix">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.editLabel}>Prix unitaire (GNF)</Text>
          <MoneyInput
            style={styles.editInput}
            value={priceEditValue}
            onChangeText={setPriceEditValue}
            autoFocus
          />
          <View style={styles.modalActionsRow}>
            <Button label="Annuler" variant="ghost" onPress={() => setPriceEditTarget(null)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSavePriceEdit} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: palette.ink },
  headerClear: { fontSize: 15, fontWeight: '600', color: palette.critical },
  form: { padding: 16, paddingBottom: 40, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 10, marginBottom: 4 },
  emptyHint: { fontSize: 13, color: palette.muted, fontStyle: 'italic', marginTop: 10 },
  // Two side-by-side columns (see the comment above their JSX) — each
  // column is a real flex:1 box, so productCardSlot below just fills 100%
  // of whichever column it's in, rather than each card carrying its own
  // percentage width the way a single wrapping row used to require.
  productsGrid: { flexDirection: 'row', gap: 8, marginTop: 10 },
  productsColumn: { flex: 1, gap: 8 },
  // Tapping this card adds it to the cart directly — no "selected" state to
  // track, just an optional badge showing how many are already in the cart.
  productCardSlot: { width: '100%' },
  productCard: {
    position: 'relative', width: '100%', backgroundColor: palette.card, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14,
  },
  // A lot/bulk product is told apart from an individual unit by this tint
  // alone — no separate tab to switch between them.
  productCardBulk: { backgroundColor: palette.mossSoft, borderColor: palette.moss + '40' },
  productLabel: { fontSize: 15, fontWeight: '600', color: palette.ink },
  productPrice: { fontSize: 13, color: palette.muted, marginTop: 2 },
  // Neutral by default — only turns into a real signal (caution/critical)
  // once stock is actually low or gone, same threshold Stock's own screen
  // already uses (StockItem.alertThreshold), never colored just to decorate.
  productStock: { fontSize: 12, color: palette.muted, marginTop: 4 },
  productStockLow: { color: palette.caution, fontWeight: '600' },
  productStockOut: { color: palette.critical, fontWeight: '600' },
  productBadge: {
    position: 'absolute', top: -6, right: -6,
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
  },
  productBadgeText: { fontSize: 12, fontWeight: '700', color: palette.white },
  // One shared card wraps the whole cart list — rows inside are flat,
  // divided by a hairline (rowDivider), not individually bordered/shadowed.
  cartList: {
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10,
  },
  cartItemLabel: { fontSize: 14, fontWeight: '600', color: palette.ink },
  // Plain muted, not moss — a per-unit price isn't a signal, just a number;
  // color here was decorating information that didn't need it.
  cartItemPrice: { fontSize: 12, color: palette.muted, marginTop: 2 },
  cartItemTotal: { fontSize: 14, fontWeight: '600', color: palette.ink },
  cartQtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Neutral fill, not a solid green pill — the +/- glyph carries the brand
  // accent, the button itself doesn't need to.
  cartQtyBtn: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  cartQtyBtnText: { fontSize: 16, color: palette.moss, fontWeight: '700' },
  cartQtyValue: { fontSize: 14, fontWeight: '700', color: palette.ink, minWidth: 18, textAlign: 'center' },
  cartRemoveBtn: { padding: 4 },
  // The one real "pay attention here" moment on this screen besides the
  // Finaliser button itself — kept as the sole other place color is used to
  // draw the eye, deliberately.
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
  editLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  editInput: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  modalActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
