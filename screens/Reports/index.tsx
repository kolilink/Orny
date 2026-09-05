import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getSales } from '../../store/sales';
import { getExpenses } from '../../store/expenses';
import { getPurchases } from '../../store/purchases';
import { Sale, Expense, Purchase, purchaseDebt } from '../../types';
import { formatGNF } from '../../utils/format';
import { computePeriodProfit } from '../../utils/finance';
import { tabularNums, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

// orange_money's dot references Orange Money's own real-world brand color
// deliberately, not the app's caution/critical tokens — same idea as a
// Visa-blue or Mastercard-orange payment icon elsewhere: it needs to be
// recognizable as that specific payment method, not reinterpreted as a
// severity signal.
const ORANGE_MONEY_BRAND = '#EF9F27';

const makePaymentColors = (palette: Palette): Record<string, string> => ({
  cash: palette.moss,
  orange_money: ORANGE_MONEY_BRAND,
  credit: palette.critical,
});

export default function ReportsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const PAYMENT_COLORS = makePaymentColors(palette);
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [expenses, setExpensesState] = useState<Expense[]>([]);
  const [purchases, setPurchasesState] = useState<Purchase[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, exp, pur] = await Promise.all([getSales(), getExpenses(), getPurchases()]);
    setSalesState(s);
    setExpensesState(exp);
    setPurchasesState(pur);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCredit = sales.filter((s) => s.paymentMethod === 'credit').reduce((sum, s) => sum + s.totalAmount, 0);
  const totalOwedToSuppliers = purchases.reduce((sum, p) => sum + purchaseDebt(p), 0);

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

  // Monthly history — all months that have sales, expenses, or purchases.
  // Profit per month goes through the same computePeriodProfit Dashboard
  // uses, so a month's figure here can never quietly disagree with what
  // Dashboard would show for that same window.
  const monthKeys = new Set<string>();
  sales.forEach((s) => monthKeys.add(s.date.slice(0, 7)));
  expenses.forEach((e) => monthKeys.add(e.date.slice(0, 7)));
  purchases.forEach((p) => monthKeys.add(p.date.slice(0, 7)));
  const monthlyHistory = Array.from(monthKeys)
    .sort((a, b) => b.localeCompare(a))
    .map((ym) => {
      const monthSales = sales.filter((s) => s.date.startsWith(ym));
      const monthExpenses = expenses.filter((e) => e.date.startsWith(ym));
      const monthPurchases = purchases.filter((p) => p.date.startsWith(ym));
      const p = computePeriodProfit(monthSales, monthExpenses, monthPurchases);
      return { ym, rev: p.revenue, costs: p.cogs + p.otherExpenses, profit: p.profit };
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

  const thisMonthPurchases = purchases.filter((p) => p.date.startsWith(thisMonthStr));
  const lastMonthPurchases = purchases.filter((p) => p.date.startsWith(lastMonthStr));

  const thisMonthProfit = computePeriodProfit(thisMonth, thisMonthExpenses, thisMonthPurchases);
  const lastMonthProfit = computePeriodProfit(lastMonth, lastMonthExpenses, lastMonthPurchases);
  const netProfit = thisMonthProfit.profit;
  const lastNetProfit = lastMonthProfit.profit;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.moss} />}
    >
      {/* Hero — the one number that answers "est-ce que l'usine avance ?".
          Everything else on this screen is detail in support of this
          number, not a competing headline — see CLAUDE.md-style reasoning:
          a factory can have high revenue and still lose money on costs, so
          leading with revenue (the old "Vue globale" card) doesn't actually
          answer the question that matters. */}
      <View style={[styles.card, styles.heroCard]}>
        <Text style={styles.heroLabel}>Bénéfice net · ce mois</Text>
        <Text style={[styles.heroValue, { color: netProfit >= 0 ? palette.moss : palette.critical }]}>
          {formatGNF(netProfit)}
        </Text>
        {lastMonthExpTotal > 0 && (
          <View style={styles.heroCompareRow}>
            <Text style={styles.heroCompareLabel}>Mois dernier : {formatGNF(lastNetProfit)}</Text>
            {lastMonthRev > 0 && (
              <Text style={[styles.heroCompareValue, { color: monthDiff >= 0 ? palette.moss : palette.critical }]}>
                {monthDiff >= 0 ? '+' : ''}{monthDiff.toFixed(1)} %
              </Text>
            )}
          </View>
        )}
        <View style={styles.heroDivider} />
        <StatRow label="Chiffre d'affaires" value={formatGNF(thisMonthRev)} />
        <StatRow
          label={thisMonthProfit.method === 'cogs' ? 'Coût des produits vendus' : 'Achats matières premières (estimation)'}
          value={formatGNF(thisMonthProfit.cogs)}
        />
        <StatRow label="Autres dépenses" value={formatGNF(thisMonthExpTotal)} />
        {thisMonthExpTotal === 0 && thisMonthProfit.cogs === 0 && (
          <Text style={styles.empty}>Ajoutez vos dépenses et achats pour voir le profit réel</Text>
        )}
        {thisMonthProfit.method === 'approx' ? (
          <View style={styles.footnoteRow}>
            <Ionicons name="information-circle-outline" size={13} color={palette.muted} />
            <Text style={styles.footnote}>
              Estimation : certaines ventes de ce mois n'ont pas de coût réel enregistré (vendues avant l'activation du suivi des coûts). Ce chiffre reprend les achats de matières premières du mois — ne le ressaisissez pas aussi comme dépense "Matière première", il serait compté deux fois.
            </Text>
          </View>
        ) : (
          <View style={styles.footnoteRow}>
            <Ionicons name="checkmark-circle-outline" size={13} color={palette.moss} />
            <Text style={styles.footnote}>
              Coût réel — calculé à partir de ce qui a été effectivement vendu ce mois-ci, pas seulement acheté.
            </Text>
          </View>
        )}
      </View>

      {/* Two real cash-flow risks — money the factory is owed, and money
          it owes. Kept small and secondary, not buried in a 6-row wall of
          stats the way the old "Vue globale" card had them. */}
      <View style={styles.secondaryRow}>
        <View style={styles.secondaryStat}>
          <Text style={styles.secondaryLabel}>En crédit (à recevoir)</Text>
          <Text style={[styles.secondaryValue, { color: totalCredit > 0 ? palette.critical : palette.ink }]}>
            {formatGNF(totalCredit)}
          </Text>
        </View>
        <View style={styles.secondaryStat}>
          <Text style={styles.secondaryLabel}>Dû aux fournisseurs</Text>
          <Text style={[styles.secondaryValue, { color: totalOwedToSuppliers > 0 ? palette.caution : palette.ink }]}>
            {formatGNF(totalOwedToSuppliers)}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Par mode de paiement</Text>
        {Object.entries(byPayment).map(([method, amount]) => (
          <View key={method} style={styles.paymentRow}>
            <View style={[styles.dot, { backgroundColor: PAYMENT_COLORS[method] ?? palette.muted }]} />
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
        <Text style={styles.cardTitle}>Historique mensuel</Text>
        {monthlyHistory.length === 0 && (
          <Text style={styles.empty}>Aucune donnée enregistrée</Text>
        )}
        {/* column headers */}
        {monthlyHistory.length > 0 && (
          <View style={styles.histRow}>
            <Text style={[styles.histCell, styles.histMonth, { color: palette.muted, fontSize: 11 }]}>MOIS</Text>
            <Text style={[styles.histCell, { color: palette.muted, fontSize: 11 }]}>VENTES</Text>
            <Text style={[styles.histCell, { color: palette.muted, fontSize: 11 }]}>COÛTS</Text>
            <Text style={[styles.histCell, { color: palette.muted, fontSize: 11 }]}>PROFIT</Text>
          </View>
        )}
        {monthlyHistory.map(({ ym, rev, costs, profit }) => (
          <View key={ym} style={[styles.histRow, ym === thisMonthStr && styles.histRowActive]}>
            <Text style={[styles.histCell, styles.histMonth]}>{monthLabel(ym)}</Text>
            <Text style={styles.histCell}>{formatGNF(rev)}</Text>
            <Text style={[styles.histCell, costs === 0 && { color: palette.muted }]}>{costs > 0 ? formatGNF(costs) : '—'}</Text>
            <Text style={[styles.histCell, { color: profit >= 0 ? palette.moss : palette.critical, fontWeight: '700' }]}>
              {costs > 0 ? formatGNF(profit) : '—'}
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
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    backgroundColor: palette.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    gap: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: palette.ink, marginBottom: 10 },
  heroCard: { gap: 0, paddingTop: 20 },
  heroLabel: { fontSize: 13, color: palette.muted, fontWeight: '600' },
  heroValue: { fontSize: 34, fontWeight: '800', marginTop: 4, ...tabularNums },
  heroCompareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10,
  },
  heroCompareLabel: { fontSize: 13, color: palette.muted },
  heroCompareValue: { fontSize: 13, fontWeight: '700', ...tabularNums },
  heroDivider: { height: 1, backgroundColor: palette.line, marginVertical: 14 },
  secondaryRow: { flexDirection: 'row', gap: 12 },
  secondaryStat: {
    flex: 1, backgroundColor: palette.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: palette.line,
  },
  secondaryLabel: { fontSize: 12, color: palette.muted, marginBottom: 4 },
  secondaryValue: { fontSize: 16, fontWeight: '700', ...tabularNums },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.line,
  },
  statLabel: { fontSize: 14, color: palette.muted },
  statValue: { fontSize: 14, fontWeight: '600', color: palette.ink, ...tabularNums },
  paymentRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: palette.line, gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  paymentLabel: { flex: 1, fontSize: 14, color: palette.ink },
  paymentAmount: { fontSize: 14, fontWeight: '600', color: palette.ink, ...tabularNums },
  paymentPct: { fontSize: 12, color: palette.muted, width: 36, textAlign: 'right' },
  clientRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: palette.line, gap: 10,
  },
  rank: { fontSize: 13, fontWeight: '700', color: palette.muted, width: 24 },
  clientName: { flex: 1, fontSize: 14, color: palette.ink, fontWeight: '500' },
  clientAmount: { fontSize: 14, fontWeight: '600', color: palette.ink, ...tabularNums },
  empty: { fontSize: 14, color: palette.muted, textAlign: 'center', paddingVertical: 12 },
  footnoteRow: { flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'flex-start' },
  footnote: { flex: 1, fontSize: 11, color: palette.muted, lineHeight: 16 },
  histRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, borderBottomWidth: 1, borderColor: palette.line,
  },
  histRowActive: { backgroundColor: palette.mossSoft, marginHorizontal: -16, paddingHorizontal: 16 },
  histCell: { flex: 1, fontSize: 12, color: palette.ink, textAlign: 'right', ...tabularNums },
  histMonth: { flex: 1.2, textAlign: 'left', fontWeight: '600', color: palette.ink },
});
