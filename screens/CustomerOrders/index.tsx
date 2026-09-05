import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Alert, Modal, ScrollView,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder, RootStackParamList } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import {
  getCustomerOrders, addCustomerOrder, updateCustomerOrderStatus,
  deleteCustomerOrder, syncCustomerOrdersFromSupabase,
} from '../../store/customerOrders';
import { formatGNF } from '../../utils/format';
import { getFactoryId } from '../../store/context';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { ConfirmDialog } from '../../components/ui';

const makeStatusConfig = (palette: Palette): Record<CustomerOrder['status'], { label: string; color: string; icon: string }> => ({
  pending:   { label: 'En attente', color: palette.caution,  icon: 'time-outline' },
  ready:     { label: 'Prêt',       color: palette.moss, icon: 'checkmark-circle-outline' },
  delivered: { label: 'Livré',      color: palette.muted, icon: 'archive-outline' },
  cancelled: { label: 'Annulé',     color: palette.critical,     icon: 'close-circle-outline' },
});

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

type OrdersRoute = RouteProp<RootStackParamList, 'CustomerOrders'>;

export default function CustomerOrdersScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const STATUS_CONFIG = makeStatusConfig(palette);
  const navigation = useNavigation();
  const { params } = useRoute<OrdersRoute>();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [addModal, setAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [clientName, setClientName] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');

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
        if (d.product) setProduct(d.product);
        if (d.qty) setQty(d.qty);
        if (d.unitPrice) setUnitPrice(d.unitPrice);
        if (d.deliveryDate) setDeliveryDate(d.deliveryDate);
        if (d.notes) setNotes(d.notes);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ clientName, product, qty, unitPrice, deliveryDate, notes }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientName, product, qty, unitPrice, deliveryDate, notes]);

  const load = useCallback(async () => {
    syncCustomerOrdersFromSupabase();
    const data = await getCustomerOrders();
    setOrders(data);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAdd() {
    const q = parseInt(qty, 10);
    const up = parseInt(unitPrice.replace(/\s/g, ''), 10);
    if (!clientName.trim()) return Alert.alert('Erreur', 'Nom du client requis.');
    if (!product.trim()) return Alert.alert('Erreur', 'Produit requis.');
    if (!q || q <= 0) return Alert.alert('Erreur', 'Quantité invalide.');
    if (!up || up <= 0) return Alert.alert('Erreur', 'Prix unitaire invalide.');
    if (!deliveryDate) return Alert.alert('Erreur', 'Date de livraison requise.');

    const item = await addCustomerOrder({
      clientName: clientName.trim(),
      product: product.trim(),
      quantity: q,
      unitPrice: up,
      totalAmount: q * up,
      deliveryDate,
      status: 'pending',
      notes: notes.trim() || undefined,
    });
    setClientName(''); setProduct(''); setQty(''); setUnitPrice('');
    setDeliveryDate(''); setNotes('');
    AsyncStorage.removeItem(draftKey);
    setAddModal(false);
    setOrders(prev => [item, ...prev]);
  }

  async function handleStatusChange(order: CustomerOrder, newStatus: CustomerOrder['status']) {
    await updateCustomerOrderStatus(order.id, newStatus);
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: newStatus } : o));
  }

  function handleDelete(id: string) {
    setDeleteTarget(id);
  }

  const activeOrders = orders.filter((o) => o.status === 'pending' || o.status === 'ready');
  const historyOrders = orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled');
  const displayed = tab === 'active' ? activeOrders : historyOrders;

  const pendingValue = activeOrders.reduce((sum, o) => sum + o.totalAmount, 0);

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

      {activeOrders.length > 0 && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {activeOrders.length} commande{activeOrders.length > 1 ? 's' : ''} en cours · {formatGNF(pendingValue)}
          </Text>
        </View>
      )}

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'active' && styles.tabActive]} onPress={() => setTab('active')}>
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>En cours ({activeOrders.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'history' && styles.tabActive]} onPress={() => setTab('history')}>
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>Historique ({historyOrders.length})</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayed}
        keyExtractor={(o) => o.id}
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{item.clientName}</Text>
                  <Text style={styles.product}>{item.product} · {item.quantity} unités</Text>
                </View>
                <Text style={styles.amount}>{formatGNF(item.totalAmount)}</Text>
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
                  {item.status === 'pending' && (
                    <TouchableOpacity style={[styles.actionBtn, { borderColor: palette.moss }]} onPress={() => handleStatusChange(item, 'ready')}>
                      <Text style={[styles.actionText, { color: palette.moss }]}>Prêt ✓</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: palette.muted }]} onPress={() => handleStatusChange(item, 'delivered')}>
                    <Text style={[styles.actionText, { color: palette.muted }]}>Livré</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: palette.critical }]} onPress={() => handleStatusChange(item, 'cancelled')}>
                    <Text style={[styles.actionText, { color: palette.critical }]}>Annuler</Text>
                  </TouchableOpacity>
                </View>
              )}

              {(item.status === 'delivered' || item.status === 'cancelled') && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}>
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
          await deleteCustomerOrder(deleteTarget);
          setOrders((prev) => prev.filter((o) => o.id !== deleteTarget));
          setDeleteTarget(null);
        }}
        title="Supprimer la commande ?"
        message="Cette action est irréversible."
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      <Modal visible={addModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAddModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Nouvelle commande</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Client *</Text>
            <TextInput style={styles.input} value={clientName} onChangeText={setClientName} placeholder="Nom du client" placeholderTextColor={palette.muted} />
            <Text style={styles.fieldLabel}>Produit *</Text>
            <TextInput style={styles.input} value={product} onChangeText={setProduct} placeholder="Ex: Produit A, Lot x10..." placeholderTextColor={palette.muted} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantité *</Text>
                <TextInput style={styles.input} value={qty} onChangeText={setQty} placeholder="100" placeholderTextColor={palette.muted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Prix unitaire *</Text>
                <TextInput style={styles.input} value={unitPrice} onChangeText={setUnitPrice} placeholder="GNF" placeholderTextColor={palette.muted} keyboardType="numeric" />
              </View>
            </View>
            {qty && unitPrice ? (
              <Text style={styles.totalPreview}>Total : {formatGNF(parseInt(qty) * parseInt(unitPrice.replace(/\s/g, ''), 10) || 0)}</Text>
            ) : null}
            <DatePickerField label="Date de livraison *" value={deliveryDate} onChange={setDeliveryDate} />
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Optionnel" placeholderTextColor={palette.muted} />
            <TouchableOpacity style={styles.confirmBtn} onPress={handleAdd}>
              <Text style={styles.confirmBtnText}>Créer la commande</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  clientName: { fontSize: 16, fontWeight: '700', color: palette.ink },
  product: { fontSize: 13, color: palette.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: palette.ink },
  cardMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  deliveryDate: { fontSize: 12, color: palette.muted },
  notes: { fontSize: 12, color: palette.muted, fontStyle: 'italic', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  actionText: { fontSize: 13, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, justifyContent: 'flex-end' },
  deleteBtnText: { fontSize: 13, color: palette.critical },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: palette.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: palette.paper, borderRadius: 12, padding: 14, fontSize: 16, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  totalPreview: { fontSize: 14, fontWeight: '700', color: palette.moss, marginTop: 6, textAlign: 'right' },
  confirmBtn: { marginTop: 20, backgroundColor: palette.moss, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: palette.white, fontSize: 16, fontWeight: '700' },
});
