import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getSales, syncSalesFromSupabase } from '../../store/sales';
import { getExpenses, syncExpensesFromSupabase } from '../../store/expenses';
import { getPurchases, syncPurchasesFromSupabase } from '../../store/purchases';
import { getInvestmentEntries, syncInvestmentEntriesFromSupabase } from '../../store/investmentEntries';
import { getDistributions, syncDistributionsFromSupabase } from '../../store/investorDistributions';
import { supabase } from '../../lib/supabase';
import { Sale, Expense, Purchase, InvestmentEntry, InvestorDistribution, purchaseDebt } from '../../types';
import { formatGNF } from '../../utils/format';
import { computePeriodProfit, computeCashOnHand } from '../../utils/finance';
import { useAuth } from '../../context/AuthContext';
import { tabularNums, typography, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { CountUpNumber, Text } from '../../components/ui';

type InvestorHeadline = {
  revenueThisMonth: number;
  profitThisMonth: number;
  profitMethod: 'cogs' | 'approx';
  revenueLastMonth: number;
  profitLastMonth: number;
  cashOnHand: number;
};

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

// credit is a payment method, not a warning — see the identical note in
// screens/Ventes/index.tsx.
const makePaymentColors = (palette: Palette): Record<string, string> => ({
  cash: palette.moss,
  orange_money: ORANGE_MONEY_BRAND,
  credit: palette.violet,
});

export default function ReportsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const PAYMENT_COLORS = makePaymentColors(palette);
  const { membership } = useAuth();
  // Trésorerie mixes in capital movements (injections/distributions) that an
  // inspecteur has no read access to (see db/update15.sql) — showing it to
  // that role would silently understate the real figure. Same gate this
  // number carried on the old Dashboard screen before it moved here.
  const canSeeCashPosition = membership?.role !== 'inspecteur';
  // Investor reads a reduced set of headline numbers via a SECURITY DEFINER
  // RPC (db/update27.sql) instead of the raw tables below — their RLS
  // access to sales/expenses/purchases/etc. was deliberately removed
  // alongside this (see the migration's own header comment), so this
  // branch isn't just a display choice, it's the only path that still
  // works for that role at all.
  const isInvestor = membership?.role === 'investor';
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [expenses, setExpensesState] = useState<Expense[]>([]);
  const [purchases, setPurchasesState] = useState<Purchase[]>([]);
  const [entries, setEntriesState] = useState<InvestmentEntry[]>([]);
  const [distributions, setDistributionsState] = useState<InvestorDistribution[]>([]);
  const [investorHeadline, setInvestorHeadline] = useState<InvestorHeadline | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Cache-first: this used to only ever read the local cache, with no sync
  // call of its own — it silently relied on some other screen (Ventes,
  // Expenses, Fournisseurs, Investors) having synced first. Reports is now
  // the landing screen for investor/inspecteur roles, so it can no longer
  // assume another screen already ran; it renders cache instantly, then
  // syncs every store it reads and re-renders once the fresh numbers land.
  const load = useCallback(async () => {
    if (isInvestor) {
      if (!membership) return;
      const { data, error } = await supabase.rpc('get_investor_headline_report', { p_factory_id: membership.factoryId });
      if (!error && data && data.length > 0) {
        const row = data[0];
        setInvestorHeadline({
          revenueThisMonth: row.revenue_this_month,
          profitThisMonth: row.profit_this_month,
          profitMethod: row.profit_method,
          revenueLastMonth: row.revenue_last_month,
          profitLastMonth: row.profit_last_month,
          cashOnHand: row.cash_on_hand,
        });
      }
      return;
    }

    const [s, exp, pur, ent, dist] = await Promise.all([
      getSales(), getExpenses(), getPurchases(), getInvestmentEntries(), getDistributions(),
    ]);
    setSalesState(s);
    setExpensesState(exp);
    setPurchasesState(pur);
    setEntriesState(ent);
    setDistributionsState(dist);

    await Promise.all([
      syncSalesFromSupabase(), syncExpensesFromSupabase(), syncPurchasesFromSupabase(),
      syncInvestmentEntriesFromSupabase(), syncDistributionsFromSupabase(),
    ]);
    const [freshS, freshExp, freshPur, freshEnt, freshDist] = await Promise.all([
      getSales(), getExpenses(), getPurchases(), getInvestmentEntries(), getDistributions(),
    ]);
    setSalesState(freshS);
    setExpensesState(freshExp);
    setPurchasesState(freshPur);
    setEntriesState(freshEnt);
    setDistributionsState(freshDist);
  }, [isInvestor, membership]);

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

  // Real liquid position — collected minus paid out, across every source of
  // cash movement (sales, expenses, purchases, capital injections/
  // distributions), not just non-credit sales with nothing subtracted.
  // Moved here from the retired Dashboard tab — this is now its only home.
  const tresorerie = computeCashOnHand(sales, expenses, purchases, entries, distributions);

  // Investor sees a deliberately shorter screen: profit + trend and cash on
  // hand only — no payment-method breakdown, no credit-outstanding/
  // supplier-debt row, since those are operational detail this role's RLS
  // access no longer reaches (see the RPC branch in load() above). Reuses
  // the same card/hero styles as the full view below, just with less on
  // the page, not a visually different screen.
  if (isInvestor) {
    const h = investorHeadline;
    const invMonthDiff = h && h.revenueLastMonth > 0 ? ((h.revenueThisMonth - h.revenueLastMonth) / h.revenueLastMonth) * 100 : 0;
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.moss} />}
      >
        <View style={[styles.card, styles.heroCard]}>
          <Text style={styles.heroLabel}>BÉNÉFICE NET · CE MOIS</Text>
          {h ? (
            <>
              <CountUpNumber
                value={h.profitThisMonth}
                formatter={formatGNF}
                style={[styles.heroValue, { color: h.profitThisMonth >= 0 ? palette.moss : palette.critical }]}
              />
              {h.revenueLastMonth > 0 && (
                <View style={styles.heroCompareRow}>
                  <Text style={styles.heroCompareLabel}>Mois dernier : {formatGNF(h.profitLastMonth)}</Text>
                  <Text style={[styles.heroCompareValue, { color: invMonthDiff >= 0 ? palette.moss : palette.critical }]}>
                    {invMonthDiff >= 0 ? '+' : ''}{invMonthDiff.toFixed(1)} %
                  </Text>
                </View>
              )}
              <View style={styles.heroDivider} />
              <StatRow label="Chiffre d'affaires" value={formatGNF(h.revenueThisMonth)} />
              {h.profitMethod === 'approx' && (
                <View style={styles.footnoteRow}>
                  <Ionicons name="information-circle-outline" size={13} color={palette.muted} />
                  <Text style={styles.footnote}>Estimation — certaines ventes de ce mois n'ont pas de coût réel enregistré.</Text>
                </View>
              )}
            </>
          ) : (
            <Text style={styles.empty}>Chargement…</Text>
          )}
        </View>

        {canSeeCashPosition && h && (
          <View style={styles.secondaryRow}>
            <View style={styles.secondaryStat}>
              <Text style={styles.secondaryLabel}>Trésorerie</Text>
              <Text style={styles.secondaryValue}>{formatGNF(h.cashOnHand)}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    );
  }

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
        <Text style={styles.heroLabel}>BÉNÉFICE NET · CE MOIS</Text>
        <CountUpNumber
          value={netProfit}
          formatter={formatGNF}
          style={[styles.heroValue, { color: netProfit >= 0 ? palette.moss : palette.critical }]}
        />
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

      {/* Trésorerie — always shown (unlike the conditional row below), since
          "how much cash do I actually have" is a live balance, not a
          settle-to-zero risk. */}
      {canSeeCashPosition && (
        <View style={styles.secondaryRow}>
          <View style={styles.secondaryStat}>
            <Text style={styles.secondaryLabel}>Trésorerie</Text>
            <Text style={styles.secondaryValue}>{formatGNF(tresorerie)}</Text>
          </View>
        </View>
      )}

      {/* Two real cash-flow risks — money the factory is owed, and money
          it owes. Kept small and secondary, not buried in a 6-row wall of
          stats the way the old "Vue globale" card had them. Shown only
          when actually non-zero — a settled 0/0 state has nothing
          actionable to surface here, same rule as the Fournisseurs debt
          banner. */}
      {(totalCredit > 0 || totalOwedToSuppliers > 0) && (
        <View style={styles.secondaryRow}>
          {totalCredit > 0 && (
            <View style={styles.secondaryStat}>
              <Text style={styles.secondaryLabel}>En crédit (à recevoir)</Text>
              <Text style={[styles.secondaryValue, { color: palette.critical }]}>
                {formatGNF(totalCredit)}
              </Text>
            </View>
          )}
          {totalOwedToSuppliers > 0 && (
            <View style={styles.secondaryStat}>
              <Text style={styles.secondaryLabel}>Dû aux fournisseurs</Text>
              <Text style={[styles.secondaryValue, { color: palette.caution }]}>
                {formatGNF(totalOwedToSuppliers)}
              </Text>
            </View>
          )}
        </View>
      )}

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
    </ScrollView>
  );
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
  heroLabel: { ...typography.eyebrow, color: palette.muted },
  heroValue: { ...typography.heroNumber, marginTop: 6, ...tabularNums },
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
  empty: { fontSize: 14, color: palette.muted, textAlign: 'center', paddingVertical: 12 },
  footnoteRow: { flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'flex-start' },
  footnote: { flex: 1, fontSize: 11, color: palette.muted, lineHeight: 16 },
});
