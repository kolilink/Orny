import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert, ScrollView } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder, RootStackParamList, ProductFlavor, BulkProduct, Client } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { ClientPicker } from '../../components/ClientPicker';
import {
  getCustomerOrders, addCustomerOrderGroup, updateCustomerOrderGroupStatus,
  deleteCustomerOrderGroup, syncCustomerOrdersFromSupabase,
} from '../../store/customerOrders';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, syncBulksFromSupabase } from '../../store/bulks';
import { getClients, upsertClient, syncClientsFromSupabase } from '../../store/clients';
import { formatGNF, formatNumber } from '../../utils/format';
import { getFactoryId } from '../../store/context';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, Text } from '../../components/ui';

const makeStatusConfig = (palette: Palette): Record<CustomerOrder['status'], { label: string; color: string; icon: string }> => ({
  pending:   { label: 'En attente', color: palette.caution,  icon: 'time-outline' },
  ready:     { label: 'Prêt',       color: palette.moss, icon: 'checkmark-circle-outline' },
  delivered: { label: 'Livré',      color: palette.muted, icon: 'archive-outline' },
  cancelled: { label: 'Annulé',     color: palette.critical,     icon: 'close-circle-outline' },
});

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// One client order, several product lines (db/update26.sql's order_group_id)
// — every CustomerOrders row sharing a group id is really one order, so the
// screen groups them back together instead of showing one card per line.
type OrderGroup = {
  groupId: string;
  clientName: string;
  deliveryDate: string;
  status: CustomerOrder['status'];
  notes?: string;
  createdAt: string;
  lines: CustomerOrder[];
  total: number;
};

function groupOrders(orders: CustomerOrder[]): OrderGroup[] {
  const byId = new Map<string, OrderGroup>();
  for (const o of orders) {
    let g = byId.get(o.orderGroupId);
    if (!g) {
      g = { groupId: o.orderGroupId, clientName: o.clientName, deliveryDate: o.deliveryDate, status: o.status, notes: o.notes, createdAt: o.createdAt, lines: [], total: 0 };
      byId.set(o.orderGroupId, g);
    }
    g.lines.push(o);
    g.total += o.totalAmount;
  }
  return Array.from(byId.values());
}

// One line being built in the "Nouvelle commande" cart, before it's saved.
type DraftLine = { key: string; product: string; quantity: number; unitPrice: number };

type OrdersRoute = RouteProp<RootStackParamList, 'CustomerOrders'>;

export default function CustomerOrdersScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const STATUS_CONFIG = makeStatusConfig(palette);
  const navigation = useNavigation();
  const { params } = useRoute<OrdersRoute>();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [flavors, setFlavors] = useState<ProductFlavor[]>([]);
  const [bulks, setBulks] = useState<BulkProduct[]>([]);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [addModal, setAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [orderMenuTarget, setOrderMenuTarget] = useState<OrderGroup | null>(null);

  const [clientName, setClientName] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Draft persistence ──────────────────────────────────────────
  const draftKey = `customer_order_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coming from a client's "add order" shortcut (Clients screen) takes
  // priority over a stale draft — a deliberate deep-link intent for THIS
  // client shouldn't be silently overwritten by an old abandoned draft for
  // a different one, so the draft is skipped entirely in that case rather
  // than loaded and then partially overwritten.
  useEffect(() => {
    if (params?.initialClientName) {
      setClientName(params.initialClientName);
      setAddModal(true);
      return;
    }
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.clientName) setClientName(d.clientName);
        if (Array.isArray(d.lines)) setLines(d.lines);
        if (d.deliveryDate) setDeliveryDate(d.deliveryDate);
        if (d.notes) setNotes(d.notes);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ clientName, lines, deliveryDate, notes }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientName, lines, deliveryDate, notes]);

  // Cache-first: render instantly from cache, then sync and re-render —
  // the sync used to fire without being awaited, so nothing ever
  // re-rendered once it actually resolved.
  const load = useCallback(async () => {
    const [o, c, fl, bk] = await Promise.all([getCustomerOrders(), getClients(), getFlavors(), getBulks()]);
    setOrders(o); setClients(c); setFlavors(fl); setBulks(bk);
    await Promise.all([syncCustomerOrdersFromSupabase(), syncClientsFromSupabase(), syncFlavorsFromSupabase(), syncBulksFromSupabase()]);
    const [freshO, freshC, freshFl, freshBk] = await Promise.all([getCustomerOrders(), getClients(), getFlavors(), getBulks()]);
    setOrders(freshO); setClients(freshC); setFlavors(freshFl); setBulks(freshBk);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Tapping an existing product adds a line, or bumps its quantity by one if
  // it's already in this order — the same tap-to-cart convention Ventes
  // uses, so this screen doesn't feel like a different app.
  function handleTapProduct(name: string, price: number) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product === name && l.unitPrice === price);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { key: `${Date.now()}-${Math.random()}`, product: name, quantity: 1, unitPrice: price }];
    });
  }

  function handleAddCustomLine() {
    const price = parseInt(customPrice.replace(/\s/g, ''), 10);
    if (!customName.trim() || !price || price <= 0) return;
    setLines((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, product: customName.trim(), quantity: 1, unitPrice: price }]);
    setCustomName(''); setCustomPrice(''); setCustomOpen(false);
  }

  function updateLineQty(key: string, qty: number) {
    if (qty <= 0) { setLines((prev) => prev.filter((l) => l.key !== key)); return; }
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l)));
  }

  function updateLinePrice(key: string, priceText: string) {
    const price = parseInt(priceText.replace(/\s/g, ''), 10) || 0;
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, unitPrice: price } : l)));
  }

  const orderTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  function resetDraft() {
    setClientName(''); setLines([]); setDeliveryDate(''); setNotes('');
    setCustomName(''); setCustomPrice(''); setCustomOpen(false);
    AsyncStorage.removeItem(draftKey);
  }

  async function handleAdd() {
    if (!clientName.trim()) return Alert.alert('Erreur', 'Nom du client requis.');
    if (lines.length === 0) return Alert.alert('Erreur', 'Ajoutez au moins un produit à la commande.');
    if (!deliveryDate) return Alert.alert('Erreur', 'Date de livraison requise.');

    setSaving(true);
    try {
      // Same as Ventes' own finalize step — a client typed here (whether
      // picked from the list or freshly typed) always ends up as a real
      // Clients row too, matching by name if one already exists rather than
      // duplicating it (upsertClient's own dedupe).
      await upsertClient(clientName.trim());
      const created = await addCustomerOrderGroup(
        clientName.trim(),
        lines.map((l) => ({ product: l.product, quantity: l.quantity, unitPrice: l.unitPrice })),
        deliveryDate,
        notes.trim() || undefined,
      );
      resetDraft();
      setAddModal(false);
      setOrders((prev) => [...created, ...prev]);
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'enregistrer la commande. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(group: OrderGroup, newStatus: CustomerOrder['status']) {
    await updateCustomerOrderGroupStatus(group.groupId, newStatus);
    setOrders((prev) => prev.map((o) => (o.orderGroupId === group.groupId ? { ...o, status: newStatus } : o)));
  }

  function handleDelete(groupId: string) {
    setDeleteTarget(groupId);
  }

  const allGroups = useMemo(() => groupOrders(orders), [orders]);
  const activeGroups = allGroups.filter((g) => g.status === 'pending' || g.status === 'ready');
  const historyGroups = allGroups.filter((g) => g.status === 'delivered' || g.status === 'cancelled');
  const displayed = tab === 'active' ? activeGroups : historyGroups;

  const pendingValue = activeGroups.reduce((sum, g) => sum + g.total, 0);

  // "+" lives in the native header (this screen has one — see the rule in
  // navigation/index.tsx), not duplicated as its own row below it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setAddModal(true)} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, palette.moss]);

  return (
    <View style={styles.container}>

      {activeGroups.length > 0 && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {activeGroups.length} commande{activeGroups.length > 1 ? 's' : ''} en cours · {formatGNF(pendingValue)}
          </Text>
        </View>
      )}

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'active' && styles.tabActive]} onPress={() => setTab('active')}>
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>En cours ({activeGroups.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'history' && styles.tabActive]} onPress={() => setTab('history')}>
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>Historique ({historyGroups.length})</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayed}
        keyExtractor={(g) => g.groupId}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === 'active'
              ? 'Aucune commande en cours\nAppuyez sur + pour en créer une'
              : 'Aucun historique de commandes'}
          </Text>
        }
        renderItem={({ item }) => {
          const cfg = STATUS_CONFIG[item.status];
          const days = daysUntil(item.deliveryDate);
          const isLate = item.status === 'pending' && days < 0;
          const isToday = days === 0;
          return (
            <View style={[styles.card, isLate && styles.cardLate]}>
              <View style={styles.cardTop}>
                <Text style={styles.clientName}>{item.clientName}</Text>
                <Text style={styles.amount}>{formatGNF(item.total)}</Text>
              </View>

              <View style={styles.linesWrap}>
                {item.lines.map((line) => (
                  <Text key={line.id} style={styles.lineText} numberOfLines={1}>
                    {line.product} · {line.quantity} {line.quantity > 1 ? 'unités' : 'unité'}
                  </Text>
                ))}
              </View>

              <View style={styles.cardMid}>
                <View style={[styles.statusPill, { backgroundColor: cfg.color + '22' }]}>
                  <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
                  <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
                <Text style={[styles.deliveryDate, isLate && { color: palette.critical }, isToday && { color: palette.caution }]}>
                  Livraison : {isLate ? `${Math.abs(days)}j de retard` : isToday ? "Aujourd'hui" : item.deliveryDate}
                </Text>
              </View>

              {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

              {(item.status === 'pending' || item.status === 'ready') && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: item.status === 'pending' ? palette.moss : palette.muted }]}
                    onPress={() => handleStatusChange(item, item.status === 'pending' ? 'ready' : 'delivered')}
                  >
                    <Text style={styles.primaryActionText}>
                      {item.status === 'pending' ? 'Prêt ✓' : 'Livré'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.moreBtn} onPress={() => setOrderMenuTarget(item)} hitSlop={8}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={palette.muted} />
                  </TouchableOpacity>
                </View>
              )}

              {(item.status === 'delivered' || item.status === 'cancelled') && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.groupId)}>
                  <Ionicons name="trash-outline" size={15} color={palette.critical} />
                  <Text style={styles.deleteBtnText}>Supprimer</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteCustomerOrderGroup(deleteTarget);
            setOrders((prev) => prev.filter((o) => o.orderGroupId !== deleteTarget));
            setDeleteTarget(null);
          } catch (e: any) {
            Alert.alert('Erreur', `Impossible de supprimer la commande. ${e?.message ?? ''}`.trim());
          }
        }}
        title="Supprimer la commande ?"
        message="Cette action est irréversible."
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Order status overflow — whichever action isn't the primary one */}
      <AppModal visible={!!orderMenuTarget} onClose={() => setOrderMenuTarget(null)} showCloseButton={false}>
        {orderMenuTarget?.status === 'pending' && (
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => { if (orderMenuTarget) handleStatusChange(orderMenuTarget, 'delivered'); setOrderMenuTarget(null); }}
          >
            <Ionicons name="archive-outline" size={18} color={palette.ink} />
            <Text style={styles.menuRowText}>Marquer livré</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() => { if (orderMenuTarget) handleStatusChange(orderMenuTarget, 'cancelled'); setOrderMenuTarget(null); }}
        >
          <Ionicons name="close-circle-outline" size={18} color={palette.critical} />
          <Text style={[styles.menuRowText, { color: palette.critical }]}>Annuler la commande</Text>
        </TouchableOpacity>
      </AppModal>

      <AppModal visible={addModal} onClose={() => setAddModal(false)} title="Nouvelle commande">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <ClientPicker
            clients={clients}
            value={clientName}
            onChangeText={setClientName}
            onClientCreated={(c) => setClients((prev) => [c, ...prev])}
          />

          <Text style={styles.fieldLabel}>Produits *</Text>
          {(flavors.length > 0 || bulks.length > 0) && (
            <View style={styles.productChips}>
              {flavors.map((f) => (
                <TouchableOpacity key={f.id} style={styles.chip} onPress={() => handleTapProduct(f.label, f.defaultPrice)}>
                  <Text style={styles.chipText}>{f.label}</Text>
                  <Text style={styles.chipPrice}>{formatNumber(f.defaultPrice)}</Text>
                </TouchableOpacity>
              ))}
              {bulks.map((b) => (
                <TouchableOpacity key={b.id} style={[styles.chip, styles.chipBulk]} onPress={() => handleTapProduct(b.name, b.unitPrice)}>
                  <Text style={styles.chipText}>{b.name}</Text>
                  <Text style={styles.chipPrice}>{formatNumber(b.unitPrice)}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.chip, styles.chipCustom]} onPress={() => setCustomOpen((v) => !v)}>
                <Ionicons name="add" size={14} color={palette.moss} />
                <Text style={styles.chipCustomText}>Produit personnalisé</Text>
              </TouchableOpacity>
            </View>
          )}
          {flavors.length === 0 && bulks.length === 0 && (
            <TouchableOpacity style={[styles.chip, styles.chipCustom, { alignSelf: 'flex-start' }]} onPress={() => setCustomOpen((v) => !v)}>
              <Ionicons name="add" size={14} color={palette.moss} />
              <Text style={styles.chipCustomText}>Ajouter un produit</Text>
            </TouchableOpacity>
          )}

          {customOpen && (
            <View style={styles.customRow}>
              <TextInput
                style={[styles.input, { flex: 1.4 }]}
                value={customName}
                onChangeText={setCustomName}
                placeholder="Nom du produit"
                placeholderTextColor={palette.muted}
              />
              <MoneyInput
                style={[styles.input, { flex: 1 }]}
                value={customPrice}
                onChangeText={setCustomPrice}
                placeholder="Prix"
              />
              <TouchableOpacity style={styles.customAddBtn} onPress={handleAddCustomLine}>
                <Ionicons name="checkmark" size={20} color={palette.white} />
              </TouchableOpacity>
            </View>
          )}

          {lines.length > 0 && (
            <View style={styles.linesList}>
              {lines.map((line, i) => (
                <React.Fragment key={line.key}>
                  {i > 0 && <View style={styles.lineDivider} />}
                  <View style={styles.orderLineRow}>
                    <Text style={styles.orderLineName} numberOfLines={1}>{line.product}</Text>
                    <View style={styles.qtyStepper}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => updateLineQty(line.key, line.quantity - 1)}>
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{line.quantity}</Text>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => updateLineQty(line.key, line.quantity + 1)}>
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <MoneyInput
                      style={styles.priceInline}
                      value={String(line.unitPrice)}
                      onChangeText={(v) => updateLinePrice(line.key, v)}
                    />
                    <TouchableOpacity onPress={() => updateLineQty(line.key, 0)}>
                      <Ionicons name="trash-outline" size={18} color={palette.critical} />
                    </TouchableOpacity>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}

          {lines.length > 0 && (
            <Text style={styles.totalPreview}>Total : {formatGNF(orderTotal)}</Text>
          )}

          <DatePickerField label="Date de livraison *" value={deliveryDate} onChange={setDeliveryDate} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholderTextColor={palette.muted} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setAddModal(false)} style={{ flex: 1 }} />
            <Button label="Créer" onPress={handleAdd} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  summaryRow: { marginHorizontal: 16, marginBottom: 8, backgroundColor: palette.mossSoft, borderRadius: 10, padding: 10 },
  summaryText: { fontSize: 13, fontWeight: '600', color: palette.moss, textAlign: 'center' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: palette.paper, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: palette.card },
  tabText: { fontSize: 13, color: palette.muted, fontWeight: '500' },
  tabTextActive: { color: palette.ink, fontWeight: '700' },
  card: { backgroundColor: palette.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: palette.line },
  cardLate: { borderColor: palette.critical, borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  clientName: { fontSize: 16, fontWeight: '700', color: palette.ink },
  linesWrap: { marginBottom: 8, gap: 1 },
  lineText: { fontSize: 13, color: palette.muted },
  amount: { fontSize: 16, fontWeight: '700', color: palette.ink },
  cardMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  deliveryDate: { fontSize: 12, color: palette.muted },
  notes: { fontSize: 12, color: palette.muted, fontStyle: 'italic', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  primaryActionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  primaryActionText: { fontSize: 13, fontWeight: '700', color: palette.white },
  moreBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, justifyContent: 'flex-end' },
  deleteBtnText: { fontSize: 13, color: palette.critical },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuRowText: { fontSize: 16, color: palette.ink, fontWeight: '500' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  totalPreview: { fontSize: 14, fontWeight: '700', color: palette.moss, marginTop: 10, textAlign: 'right' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },

  // Product chip picker — tap to add, same interaction as Ventes' grid, just
  // compact enough to sit inside a form modal alongside everything else.
  productChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: palette.card, borderRadius: 10, borderWidth: 1, borderColor: palette.line,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 90,
  },
  chipBulk: { backgroundColor: palette.mossSoft, borderColor: palette.moss + '40' },
  chipText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  chipPrice: { fontSize: 11, color: palette.muted, marginTop: 1 },
  chipCustom: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.mossSoft, borderColor: palette.moss + '40', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  chipCustomText: { fontSize: 13, fontWeight: '600', color: palette.moss },
  customRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  customAddBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: palette.moss,
    alignItems: 'center', justifyContent: 'center',
  },

  // In-modal order cart — the small list of products being added to this
  // one order, mirroring Ventes' own cart row shape.
  linesList: {
    backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.line,
    marginTop: 12, overflow: 'hidden',
  },
  lineDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  orderLineRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  orderLineName: { flex: 1, fontSize: 14, fontWeight: '600', color: palette.ink },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { width: 26, height: 26, borderRadius: 7, backgroundColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 15, color: palette.moss, fontWeight: '700' },
  qtyValue: { fontSize: 14, fontWeight: '700', color: palette.ink, minWidth: 16, textAlign: 'center' },
  priceInline: {
    width: 78, backgroundColor: palette.paper, borderRadius: 8, borderWidth: 1,
    borderColor: palette.line, padding: 6, fontSize: 13, color: palette.ink, textAlign: 'right',
  },
});
