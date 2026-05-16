import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getSales } from '../../store/sales';
import { getClients } from '../../store/clients';
import { getExpenses } from '../../store/expenses';
import { Sale, Expense } from '../../types';
import { formatGNF } from '../../utils/format';

const C = {
  primary: '#1D9E75',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
  orange: '#EF9F27',
  red: '#E24B4A',
  purple: '#8E44AD',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

const PAYMENT_COLORS: Record<string, string> = {
  cash: C.primary,
  orange_money: C.orange,
  credit: C.red,
};

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [expenses, setExpensesState] = useState<Expense[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, clients, exp] = await Promise.all([getSales(), getClients(), getExpenses()]);
    setSalesState(s);
    setClientCount(clients.length);
    setExpensesState(exp);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalPaid = sales.filter((s) => s.paymentMethod !== 'credit').reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCredit = sales.filter((s) => s.paymentMethod === 'credit').reduce((sum, s) => sum + s.totalAmount, 0);

  const byPayment: Record<string, number> = {};
  sales.forEach((s) => {
    byPayment[s.paymentMethod] = (byPayment[s.paymentMethod] ?? 0) + s.totalAmount;
  });

  const byClient: Record<string, number> = {};
  sales.forEach((s) => {
    byClient[s.clientName] = (byClient[s.clientName] ?? 0) + s.totalAmount;
  });
  const topClients = Object.entries(byClient)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Monthly history — all months that have sales or expenses
  const monthKeys = new Set<string>();
  sales.forEach((s) => monthKeys.add(s.date.slice(0, 7)));
  expenses.forEach((e) => monthKeys.add(e.date.slice(0, 7)));
  const monthlyHistory = Array.from(monthKeys)
    .sort((a, b) => b.localeCompare(a))
    .map((ym) => {
      const rev = sales.filter((s) => s.date.startsWith(ym)).reduce((sum, s) => sum + s.totalAmount, 0);
      const exp = expenses.filter((e) => e.date.startsWith(ym)).reduce((sum, e) => sum + e.amount, 0);
      return { ym, rev, exp, profit: rev - exp };
    });

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisMonth = sales.filter((s) => s.date.startsWith(thisMonthStr));
  const lastMonth = sales.filter((s) => s.date.startsWith(lastMonthStr));
  const thisMonthRev = thisMonth.reduce((sum, s) => sum + s.totalAmount, 0);
  const lastMonthRev = lastMonth.reduce((sum, s) => sum + s.totalAmount, 0);
  const monthDiff = lastMonthRev > 0 ? ((thisMonthRev - lastMonthRev) / lastMonthRev) * 100 : 0;

  const thisMonthExpenses = expenses.filter((e) => e.date.startsWith(thisMonthStr));
  const lastMonthExpenses = expenses.filter((e) => e.date.startsWith(lastMonthStr));
  const thisMonthExpTotal = thisMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const lastMonthExpTotal = lastMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = thisMonthRev - thisMonthExpTotal;
  const lastNetProfit = lastMonthRev - lastMonthExpTotal;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <Text style={styles.pageTitle}>Rapports</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vue globale</Text>
        <StatRow label="Chiffre d'affaires total" value={formatGNF(totalRevenue)} />
        <StatRow label="Encaissé (hors crédit)" value={formatGNF(totalPaid)} />
        <StatRow label="En crédit (à recouvrer)" value={formatGNF(totalCredit)} valueColor={C.red} />
        <StatRow label="Nombre de ventes" value={String(sales.length)} />
        <StatRow label="Nombre de clients" value={String(clientCount)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ce mois vs mois dernier</Text>
        <StatRow label="Ce mois" value={formatGNF(thisMonthRev)} />
        <StatRow label="Mois dernier" value={formatGNF(lastMonthRev)} />
        {lastMonthRev > 0 && (
          <View style={styles.diffRow}>
            <Text style={styles.diffLabel}>Évolution CA</Text>
            <Text style={[styles.diffValue, { color: monthDiff >= 0 ? C.primary : C.red }]}>
              {monthDiff >= 0 ? '+' : ''}{monthDiff.toFixed(1)} %
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Compte de résultat — ce mois</Text>
        <StatRow label="Chiffre d'affaires" value={formatGNF(thisMonthRev)} />
        <StatRow label="Dépenses enregistrées" value={formatGNF(thisMonthExpTotal)} valueColor={thisMonthExpTotal > 0 ? C.red : undefined} />
        <View style={[styles.diffRow, { borderTopWidth: 1, borderColor: C.border }]}>
          <Text style={[styles.diffLabel, { fontWeight: '700' }]}>Profit net</Text>
          <Text style={[styles.diffValue, { color: netProfit >= 0 ? C.primary : C.red }]}>
            {formatGNF(netProfit)}
          </Text>
        </View>
        {lastMonthExpTotal > 0 && (
          <StatRow label="Profit net mois dernier" value={formatGNF(lastNetProfit)} valueColor={lastNetProfit < 0 ? C.red : C.muted} />
        )}
        {thisMonthExpTotal === 0 && (
          <Text style={styles.empty}>Ajoutez vos dépenses pour voir le profit réel</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Par mode de paiement</Text>
        {Object.entries(byPayment).map(([method, amount]) => (
          <View key={method} style={styles.paymentRow}>
            <View style={[styles.dot, { backgroundColor: PAYMENT_COLORS[method] ?? C.muted }]} />
            <Text style={styles.paymentLabel}>{PAYMENT_LABELS[method] ?? method}</Text>
            <Text style={styles.paymentAmount}>{formatGNF(amount)}</Text>
            {totalRevenue > 0 && (
              <Text style={styles.paymentPct}>
                {((amount / totalRevenue) * 100).toFixed(0)} %
              </Text>
            )}
          </View>
        ))}
        {Object.keys(byPayment).length === 0 && (
          <Text style={styles.empty}>Aucune vente enregistrée</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top 5 clients</Text>
        {topClients.map(([name, amount], i) => (
          <View key={name} style={styles.clientRow}>
            <Text style={styles.rank}>#{i + 1}</Text>
            <Text style={styles.clientName}>{name}</Text>
            <Text style={styles.clientAmount}>{formatGNF(amount)}</Text>
          </View>
        ))}
        {topClients.length === 0 && (
          <Text style={styles.empty}>Aucune vente enregistrée</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Historique mensuel complet</Text>
        {monthlyHistory.length === 0 && (
          <Text style={styles.empty}>Aucune donnée enregistrée</Text>
        )}
        {/* column headers */}
        {monthlyHistory.length > 0 && (
          <View style={styles.histRow}>
            <Text style={[styles.histCell, styles.histMonth, { color: C.muted, fontSize: 11 }]}>MOIS</Text>
            <Text style={[styles.histCell, { color: C.muted, fontSize: 11 }]}>VENTES</Text>
            <Text style={[styles.histCell, { color: C.muted, fontSize: 11 }]}>DÉPENSES</Text>
            <Text style={[styles.histCell, { color: C.muted, fontSize: 11 }]}>PROFIT</Text>
          </View>
        )}
        {monthlyHistory.map(({ ym, rev, exp, profit }) => (
          <View key={ym} style={[styles.histRow, ym === thisMonthStr && styles.histRowActive]}>
            <Text style={[styles.histCell, styles.histMonth]}>{monthLabel(ym)}</Text>
            <Text style={styles.histCell}>{formatGNF(rev)}</Text>
            <Text style={[styles.histCell, { color: exp > 0 ? C.red : C.muted }]}>{exp > 0 ? formatGNF(exp) : '—'}</Text>
            <Text style={[styles.histCell, { color: profit >= 0 ? C.primary : C.red, fontWeight: '700' }]}>
              {exp > 0 ? formatGNF(profit) : '—'}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  const months = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 4 },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    gap: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 10 },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border,
  },
  statLabel: { fontSize: 14, color: C.muted },
  statValue: { fontSize: 14, fontWeight: '600', color: C.text },
  diffRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
  },
  diffLabel: { fontSize: 14, color: C.muted },
  diffValue: { fontSize: 16, fontWeight: '700' },
  paymentRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border, gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  paymentLabel: { flex: 1, fontSize: 14, color: C.text },
  paymentAmount: { fontSize: 14, fontWeight: '600', color: C.text },
  paymentPct: { fontSize: 12, color: C.muted, width: 36, textAlign: 'right' },
  clientRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border, gap: 10,
  },
  rank: { fontSize: 13, fontWeight: '700', color: C.muted, width: 24 },
  clientName: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  clientAmount: { fontSize: 14, fontWeight: '600', color: C.text },
  empty: { fontSize: 14, color: C.muted, textAlign: 'center', paddingVertical: 12 },
  histRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, borderBottomWidth: 1, borderColor: C.border,
  },
  histRowActive: { backgroundColor: '#F0FBF7', marginHorizontal: -16, paddingHorizontal: 16 },
  histCell: { flex: 1, fontSize: 12, color: C.text, textAlign: 'right' },
  histMonth: { flex: 1.2, textAlign: 'left', fontWeight: '600', color: C.text },
});
