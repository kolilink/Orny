import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Sale } from '../../types';
import { getSales, updateSale, syncSalesFromSupabase } from '../../store/sales';
import { saleDebt } from '../../types';
import { formatGNF } from '../../utils/format';

const C = {
  primary: '#1D9E75', red: '#E24B4A', orange: '#EF9F27',
  bg: '#F8F8F6', card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

function daysOld(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function agingColor(days: number): string {
  if (days > 30) return C.red;
  if (days > 7) return C.orange;
  return C.primary;
}

function agingLabel(days: number): string {
  if (days === 0) return "Auj.";
  if (days === 1) return 'Hier';
  return `${days}j`;
}

type DebtorGroup = {
  name: string;
  totalDebt: number;
  sales: Array<{ sale: Sale; debt: number; days: number }>;
};

export default function CreancesScreen() {
  const insets = useSafeAreaInsets();
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [partialSale, setPartialSale] = useState<Sale | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const load = useCallback(async () => {
    syncSalesFromSupabase();
    const data = await getSales();
    setSalesState(data);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const debtSales = sales.filter((s) => saleDebt(s) > 0);
  const totalDebt = debtSales.reduce((sum, s) => sum + saleDebt(s), 0);

  const groupMap: Record<string, DebtorGroup> = {};
  debtSales.forEach((s) => {
    const debt = saleDebt(s);
    const days = daysOld(s.date);
    if (!groupMap[s.clientName]) groupMap[s.clientName] = { name: s.clientName, totalDebt: 0, sales: [] };
    groupMap[s.clientName].totalDebt += debt;
    groupMap[s.clientName].sales.push({ sale: s, debt, days });
  });
  const groups = Object.values(groupMap).sort((a, b) => b.totalDebt - a.totalDebt);

  async function handleMarkPaid(sale: Sale) {
    Alert.alert(
      'Marquer comme payé ?',
      `${sale.clientName} — ${formatGNF(saleDebt(sale))}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Payé ✓', onPress: async () => {
            await updateSale(sale.id, { amountPaid: sale.totalAmount });
            const data = await getSales();
            setSalesState(data);
          },
        },
      ],
    );
  }

  async function handleConfirmPartial() {
    if (!partialSale) return;
    const amount = parseInt(partialAmount.replace(/\s/g, ''), 10);
    if (!amount || amount <= 0) return Alert.alert('Erreur', 'Montant invalide.');
    const alreadyPaid = partialSale.amountPaid ?? 0;
    const newPaid = Math.min(alreadyPaid + amount, partialSale.totalAmount);
    await updateSale(partialSale.id, { amountPaid: newPaid });
    setPartialSale(null);
    setPartialAmount('');
    const data = await getSales();
    setSalesState(data);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Créances</Text>
        {totalDebt > 0 && (
          <View style={styles.totalPill}>
            <Text style={styles.totalPillText}>{formatGNF(totalDebt)}</Text>
          </View>
        )}
      </View>

      {groups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle" size={60} color={C.primary} />
          <Text style={styles.emptyTitle}>Aucune créance</Text>
          <Text style={styles.emptyDesc}>Tous vos clients sont à jour.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.name}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.primary }]} /><Text style={styles.legendText}>{'< 7j'}</Text></View>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.orange }]} /><Text style={styles.legendText}>7–30j</Text></View>
              <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.legendText}>{'>30j'}</Text></View>
            </View>
          }
          renderItem={({ item: group }) => {
            const isExpanded = expandedClient === group.name;
            const worstAge = Math.max(...group.sales.map((s) => s.days));
            const badgeColor = agingColor(worstAge);
            return (
              <View style={styles.groupCard}>
                <TouchableOpacity
                  style={styles.groupHeader}
                  onPress={() => setExpandedClient(isExpanded ? null : group.name)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.ageBadge, { backgroundColor: badgeColor + '22' }]}>
                    <Text style={[styles.ageBadgeText, { color: badgeColor }]}>{agingLabel(worstAge)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.clientName}>{group.name}</Text>
                    <Text style={styles.salesCount}>
                      {group.sales.length} vente{group.sales.length > 1 ? 's' : ''} impayée{group.sales.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.debtAmount}>{formatGNF(group.totalDebt)}</Text>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} style={{ marginTop: 2 }} />
                  </View>
                </TouchableOpacity>

                {isExpanded && group.sales.map(({ sale, debt, days }) => (
                  <View key={sale.id} style={styles.saleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.saleProduct}>{sale.product}</Text>
                      <Text style={styles.saleMeta}>{sale.date}  ·  Total : {formatGNF(sale.totalAmount)}</Text>
                      {(sale.amountPaid ?? 0) > 0 && (
                        <Text style={styles.salePaid}>Déjà payé : {formatGNF(sale.amountPaid ?? 0)}</Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={[styles.debtBadge, { color: agingColor(days) }]}>{formatGNF(debt)}</Text>
                      <TouchableOpacity style={styles.paidBtn} onPress={() => handleMarkPaid(sale)}>
                        <Text style={styles.paidBtnText}>Payé ✓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.partialBtn} onPress={() => { setPartialSale(sale); setPartialAmount(''); }}>
                        <Text style={styles.partialBtnText}>Partiel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            );
          }}
        />
      )}

      {/* Partial payment modal */}
      <Modal visible={!!partialSale} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setPartialSale(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Paiement partiel</Text>
          {partialSale && (
            <>
              <Text style={styles.sheetSub}>{partialSale.clientName} — Reste : {formatGNF(saleDebt(partialSale))}</Text>
              <Text style={styles.fieldLabel}>Montant encaissé (GNF)</Text>
              <TextInput
                style={styles.input}
                value={partialAmount}
                onChangeText={setPartialAmount}
                placeholder="Ex: 50000"
                placeholderTextColor={C.muted}
                keyboardType="numeric"
                autoFocus
              />
              <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmPartial}>
                <Text style={styles.confirmBtnText}>Confirmer</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  totalPill: { backgroundColor: '#FDECEA', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  totalPillText: { fontSize: 14, fontWeight: '800', color: C.red },
  legend: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: C.muted },
  groupCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  ageBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 46, alignItems: 'center' },
  ageBadgeText: { fontSize: 13, fontWeight: '700' },
  clientName: { fontSize: 16, fontWeight: '700', color: C.text },
  salesCount: { fontSize: 12, color: C.muted, marginTop: 2 },
  debtAmount: { fontSize: 16, fontWeight: '800', color: C.red },
  saleRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderTopWidth: 1, borderColor: '#F0F0EE', backgroundColor: '#FAFAF8' },
  saleProduct: { fontSize: 14, fontWeight: '600', color: C.text },
  saleMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  salePaid: { fontSize: 12, color: C.primary, marginTop: 2 },
  debtBadge: { fontSize: 15, fontWeight: '700' },
  paidBtn: { backgroundColor: '#E8F6F0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  paidBtnText: { fontSize: 13, color: C.primary, fontWeight: '700' },
  partialBtn: { backgroundColor: '#FFF3E6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  partialBtnText: { fontSize: 13, color: C.orange, fontWeight: '700' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginTop: 16 },
  emptyDesc: { fontSize: 15, color: C.muted, marginTop: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 6 },
  sheetSub: { fontSize: 14, color: C.muted, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 8 },
  input: { backgroundColor: '#F8F8F6', borderRadius: 12, padding: 14, fontSize: 16, color: C.text, borderWidth: 1, borderColor: C.border },
  confirmBtn: { marginTop: 16, backgroundColor: C.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
