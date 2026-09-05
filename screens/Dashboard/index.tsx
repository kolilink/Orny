import React, { useState, useCallback } from 'react';
import {
  ScrollView, StyleSheet, Text, View, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getSales, syncSalesFromSupabase } from '../../store/sales';
import { getBatches, syncBatchesFromSupabase } from '../../store/batches';
import { getWeeklyTarget } from '../../store/weeklyTarget';
import { getStock, syncStockFromSupabase } from '../../store/stock';
import { getClients } from '../../store/clients';
import { getExpenses, syncExpensesFromSupabase } from '../../store/expenses';
import { getCustomerOrders, syncCustomerOrdersFromSupabase } from '../../store/customerOrders';
import { getPurchases, syncPurchasesFromSupabase } from '../../store/purchases';
import { getInvestmentEntries, syncInvestmentEntriesFromSupabase } from '../../store/investmentEntries';
import { getDistributions, syncDistributionsFromSupabase } from '../../store/investorDistributions';
import { checkStockAlerts, checkOverdueOrders, checkPredictiveStockAlerts } from '../../utils/notifications';
import { formatGNF } from '../../utils/format';
import { isToday, isThisWeek, getLast7Days, getDayLabel } from '../../utils/dates';
import { computePeriodProfit, computeCashOnHand } from '../../utils/finance';
import { Sale, StockItem, Batch, Expense, Purchase, InvestmentEntry, InvestorDistribution, CustomerOrder } from '../../types';
import { FACTORY_CONFIG } from '../../config/factory';
import { useAuth } from '../../context/AuthContext';
import { radius, spacing, typography, tabularNums, cardElevation, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useAuth();
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [batches, setBatchesState] = useState<Batch[]>([]);
  const [stock, setStockState] = useState<StockItem[]>([]);
  const [expenses, setExpensesState] = useState<Expense[]>([]);
  const [purchases, setPurchasesState] = useState<Purchase[]>([]);
  const [entries, setEntriesState] = useState<InvestmentEntry[]>([]);
  const [distributions, setDistributionsState] = useState<InvestorDistribution[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [orders, setOrdersState] = useState<CustomerOrder[]>([]);
  const [weeklyTarget, setWeeklyTargetState] = useState<number>(FACTORY_CONFIG.weeklyProductionTarget);
  const [refreshing, setRefreshing] = useState(false);

  // Trésorerie mixes in capital movements (injections/distributions) that
  // an inspecteur has no read access to (see db/update15.sql) — showing it
  // to that role would silently understate the real figure. Profit stays
  // visible: it's derived only from revenue/expenses/cost of goods, all of
  // which inspecteur can read in full.
  const canSeeFinancials = membership?.role !== 'employee';
  const canSeeCashPosition = canSeeFinancials && membership?.role !== 'inspecteur';

  const load = useCallback(async () => {
    // Read from cache immediately (fast for returning users)
    const [s, b, st, clients, exp, ord, wt, pur, ent, dist] = await Promise.all([
      getSales(), getBatches(), getStock(), getClients(), getExpenses(), getCustomerOrders(), getWeeklyTarget(),
      getPurchases(), getInvestmentEntries(), getDistributions(),
    ]);
    setSalesState(s);
    setBatchesState(b);
    setStockState(st);
    setClientCount(clients.length);
    setExpensesState(exp);
    setOrdersState(ord);
    setWeeklyTargetState(wt);
    setPurchasesState(pur);
    setEntriesState(ent);
    setDistributionsState(dist);
    checkStockAlerts(st);
    checkOverdueOrders(ord);
    checkPredictiveStockAlerts(st, b, s);
    // Sync from Supabase in background — essential for new devices (investors)
    syncSalesFromSupabase().then(() => getSales().then(setSalesState));
    syncBatchesFromSupabase().then(() => getBatches().then(setBatchesState));
    syncStockFromSupabase().then(() => getStock().then((st2) => { setStockState(st2); checkStockAlerts(st2); }));
    syncExpensesFromSupabase().then(() => getExpenses().then(setExpensesState));
    syncCustomerOrdersFromSupabase().then(() => getCustomerOrders().then((ord2) => { setOrdersState(ord2); checkOverdueOrders(ord2); }));
    syncPurchasesFromSupabase().then(() => getPurchases().then(setPurchasesState));
    syncInvestmentEntriesFromSupabase().then(() => getInvestmentEntries().then(setEntriesState));
    syncDistributionsFromSupabase().then(() => getDistributions().then(setDistributionsState));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const todaySales = sales.filter((s) => isToday(s.date));
  const weekSales = sales.filter((s) => isThisWeek(s.date));

  const todayRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
  const weekRevenue = weekSales.reduce((sum, s) => sum + s.totalAmount, 0);
  // Real liquid position — collected minus paid out, across every source
  // of cash movement, not just non-credit sales with nothing subtracted.
  const tresorerie = computeCashOnHand(sales, expenses, purchases, entries, distributions);

  const weekBatches = batches.filter((b) => isThisWeek(b.date));
  const weekExpenses = expenses.filter((e) => isThisWeek(e.date));
  const weekPurchases = purchases.filter((p) => isThisWeek(p.date));
  const weekProfit = computePeriodProfit(weekSales, weekExpenses, weekPurchases);
  const realMargin = weekProfit.profit;

  const weeklyUnits = weekBatches.reduce((sum, b) => sum + b.unitsProduced, 0);
  const target = weeklyTarget;
  const progressPct = Math.min((weeklyUnits / target) * 100, 100);

  const criticalItems = stock.filter((i) => i.currentLevel < i.alertThreshold);
  const isLosingMoney = weekRevenue > 0 && realMargin < 0;
  const dayOfWeek = new Date().getDay();
  const isProductionLate = dayOfWeek >= 3 && weeklyUnits < target * 0.5;

  const last7 = getLast7Days();
  const dailyTotals = last7.map((date) =>
    sales.filter((s) => s.date === date).reduce((sum, s) => sum + s.totalAmount, 0)
  );
  const maxDaily = Math.max(...dailyTotals, 1);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.moss} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.factoryName}>{membership?.factoryName ?? FACTORY_CONFIG.name}</Text>
        <Text style={styles.headerDate}>
          {new Date().toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </Text>
      </View>

      {isLosingMoney && (
        <Banner tone="critical" icon="trending-down" text="Vous perdez de l'argent cette semaine" />
      )}
      {criticalItems.map((item) => (
        <Banner key={item.id} tone="critical" icon="alert-circle" text={`Stock critique : ${item.name}`} />
      ))}
      {isProductionLate && (
        <Banner tone="caution" icon="time" text="Production en retard sur l'objectif" />
      )}

      <View style={styles.revenueCard}>
        <Text style={styles.revenueLabel}>Recettes aujourd'hui</Text>
        <Text style={styles.revenueAmount}>{formatGNF(todayRevenue)}</Text>
      </View>

      <View style={styles.grid}>
        <MetricCard label="Ventes cette semaine" value={formatGNF(weekRevenue)} />
        {canSeeFinancials && (
          <MetricCard
            label={weekExpenses.length > 0 || weekPurchases.length > 0 ? 'Profit net (semaine)' : 'Marge estimée (sem.)'}
            value={formatGNF(realMargin)}
            valueColor={realMargin < 0 ? palette.critical : undefined}
          />
        )}
        {canSeeCashPosition && (
          <MetricCard label="Trésorerie" value={formatGNF(tresorerie)} />
        )}
        <MetricCard label="Nombre de clients" value={String(clientCount)} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Production cette semaine</Text>
        <Text style={styles.progressText}>
          {weeklyUnits} unités / {target} unités objectif
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progressPct}%` as `${number}%` }]} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Ventes — 7 derniers jours</Text>
        <View style={styles.barChart}>
          {last7.map((date, i) => (
            <View key={date} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height: `${(dailyTotals[i] / maxDaily) * 100}%` as `${number}%` },
                  ]}
                />
              </View>
              <Text style={styles.barLabel}>{getDayLabel(date)}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Banner({
  tone, icon, text,
}: {
  tone: 'caution' | 'critical'; icon: React.ComponentProps<typeof Ionicons>['name']; text: string;
}) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const bg = tone === 'critical' ? palette.criticalSoft : palette.cautionSoft;
  const fg = tone === 'critical' ? palette.critical : palette.caution;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={16} color={fg} />
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

function MetricCard({
  label, value, valueColor,
}: {
  label: string; value: string; valueColor?: string;
}) {
  const { palette } = useTheme();
  const mStyles = makeMStyles(palette);
  return (
    <View style={mStyles.card}>
      <Text style={mStyles.label}>{label}</Text>
      <Text style={[mStyles.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const makeMStyles = (palette: Palette) => StyleSheet.create({
  card: { width: '48%' },
  label: { ...typography.caption, color: palette.muted, marginBottom: 6 },
  value: { ...typography.bodyBold, color: palette.ink, ...tabularNums },
});

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { marginBottom: spacing.xs },
  factoryName: { ...typography.screenTitle, color: palette.ink },
  headerDate: { ...typography.body, color: palette.muted, marginTop: 2, textTransform: 'capitalize' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.sm, padding: spacing.md,
  },
  bannerText: { ...typography.bodyBold, fontSize: 14, flex: 1 },
  revenueCard: {
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: palette.line, marginBottom: spacing.xs,
  },
  revenueLabel: { ...typography.body, color: palette.muted, marginBottom: spacing.xs },
  revenueAmount: { ...typography.hero, color: palette.ink, ...tabularNums },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg, columnGap: spacing.md },
  panel: {
    backgroundColor: palette.card, borderRadius: radius.md, padding: spacing.lg,
    ...cardElevation,
  },
  panelTitle: { ...typography.sectionTitle, color: palette.ink, marginBottom: spacing.sm },
  progressText: { ...typography.body, color: palette.muted, marginBottom: spacing.sm, ...tabularNums },
  // A neutral track (not a dark tint of the same green as the fill) so the
  // fill actually reads as "a bar," not just a slightly-brighter smudge on
  // a same-hue background — mossSoft-on-mossSoft was nearly invisible.
  track: { height: 6, backgroundColor: palette.line, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: palette.moss, borderRadius: 4 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 5 },
  barCol: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: {
    flex: 1, width: '100%', justifyContent: 'flex-end',
    backgroundColor: palette.line, borderRadius: 4, overflow: 'hidden',
  },
  barFill: { width: '100%', backgroundColor: palette.moss, borderRadius: 4 },
  barLabel: { ...typography.caption, color: palette.muted, marginTop: 4 },
});
