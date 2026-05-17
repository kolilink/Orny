import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Alert, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import {
  getCustomerOrders, addCustomerOrder, updateCustomerOrderStatus,
  deleteCustomerOrder, syncCustomerOrdersFromSupabase,
} from '../../store/customerOrders';
import { formatGNF } from '../../utils/format';
import { getFactoryId } from '../../store/context';

const C = {
  primary: '#1D9E75', red: '#E24B4A', orange: '#EF9F27',
  bg: '#F8F8F6', card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

const STATUS_CONFIG: Record<CustomerOrder['status'], { label: string; color: string; icon: string }> = {
  pending:   { label: 'En attente', color: C.orange,  icon: 'time-outline' },
  ready:     { label: 'Prêt',       color: C.primary, icon: 'checkmark-circle-outline' },
  delivered: { label: 'Livré',      color: '#6B6B66', icon: 'archive-outline' },
  cancelled: { label: 'Annulé',     color: C.red,     icon: 'close-circle-outline' },
};

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

export default function CustomerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [addModal, setAddModal] = useState(false);

  const [clientName, setClientName] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');

  // ── Draft persistence ──────────────────────────────────────────
  const draftKey = `customer_order_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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

  async function handleDelete(id: string) {
    Alert.alert('Supprimer la commande ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          await deleteCustomerOrder(id);
          setOrders((prev) => prev.filter((o) => o.id !== id));
        },
      },
    ]);
  }

  const activeOrders = orders.filter((o) => o.status === 'pending' || o.status === 'ready');
  const historyOrders = orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled');
  const displayed = tab === 'active' ? activeOrders : historyOrders;

  const pendingValue = activeOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Commandes clients</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Ionicons name="add" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

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
                <Text style={[styles.deliveryDate, isLate && { color: C.red }, isToday && { color: C.orange }]}>
                  Livraison : {isLate ? `${Math.abs(days)}j de retard` : isToday ? "Aujourd'hui" : item.deliveryDate}
                </Text>
              </View>

              {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

              {(item.status === 'pending' || item.status === 'ready') && (
                <View style={styles.actions}>
                  {item.status === 'pending' && (
                    <TouchableOpacity style={[styles.actionBtn, { borderColor: C.primary }]} onPress={() => handleStatusChange(item, 'ready')}>
                      <Text style={[styles.actionText, { color: C.primary }]}>Prêt ✓</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: C.muted }]} onPress={() => handleStatusChange(item, 'delivered')}>
                    <Text style={[styles.actionText, { color: C.muted }]}>Livré</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: C.red }]} onPress={() => handleStatusChange(item, 'cancelled')}>
                    <Text style={[styles.actionText, { color: C.red }]}>Annuler</Text>
                  </TouchableOpacity>
                </View>
              )}

              {(item.status === 'delivered' || item.status === 'cancelled') && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}>
                  <Ionicons name="trash-outline" size={15} color={C.red} />
                  <Text style={styles.deleteBtnText}>Supprimer</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      <Modal visible={addModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAddModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Nouvelle commande</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Client *</Text>
            <TextInput style={styles.input} value={clientName} onChangeText={setClientName} placeholder="Nom du client" placeholderTextColor={C.muted} />
            <Text style={styles.fieldLabel}>Produit *</Text>
            <TextInput style={styles.input} value={product} onChangeText={setProduct} placeholder="Ex: SOL 80g, Lot x10..." placeholderTextColor={C.muted} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantité *</Text>
                <TextInput style={styles.input} value={qty} onChangeText={setQty} placeholder="100" placeholderTextColor={C.muted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Prix unitaire *</Text>
                <TextInput style={styles.input} value={unitPrice} onChangeText={setUnitPrice} placeholder="GNF" placeholderTextColor={C.muted} keyboardType="numeric" />
              </View>
            </View>
            {qty && unitPrice ? (
              <Text style={styles.totalPreview}>Total : {formatGNF(parseInt(qty) * parseInt(unitPrice.replace(/\s/g, ''), 10) || 0)}</Text>
            ) : null}
            <DatePickerField label="Date de livraison *" value={deliveryDate} onChange={setDeliveryDate} />
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Optionnel" placeholderTextColor={C.muted} />
            <TouchableOpacity style={styles.confirmBtn} onPress={handleAdd}>
              <Text style={styles.confirmBtnText}>Créer la commande</Text>
            </TouchableOpacity>
          </ScrollView>
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
  summaryRow: { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#E8F6F0', borderRadius: 10, padding: 10 },
  summaryText: { fontSize: 13, fontWeight: '600', color: C.primary, textAlign: 'center' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#EDEDEB', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: C.card },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  tabTextActive: { color: C.text, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  cardLate: { borderColor: C.red, borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  clientName: { fontSize: 16, fontWeight: '700', color: C.text },
  product: { fontSize: 13, color: C.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: C.text },
  cardMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  deliveryDate: { fontSize: 12, color: C.muted },
  notes: { fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  actionText: { fontSize: 13, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, justifyContent: 'flex-end' },
  deleteBtnText: { fontSize: 13, color: C.red },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40, fontSize: 15, lineHeight: 24 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#F8F8F6', borderRadius: 12, padding: 14, fontSize: 16, color: C.text, borderWidth: 1, borderColor: C.border },
  totalPreview: { fontSize: 14, fontWeight: '700', color: C.primary, marginTop: 6, textAlign: 'right' },
  confirmBtn: { marginTop: 20, backgroundColor: C.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
