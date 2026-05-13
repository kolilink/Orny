import React, { useState, useCallback } from 'react';
import {
  ScrollView, StyleSheet, Text, View, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getSales } from '../../store/sales';
import { getBatches } from '../../store/production';
import { getStock } from '../../store/stock';
import { getClients } from '../../store/clients';
import { formatGNF } from '../../utils/format';
import { isToday, isThisWeek, getLast7Days, getDayLabel } from '../../utils/dates';
import { Sale, StockItem, ProductionBatch } from '../../types';
import { FACTORY_CONFIG } from '../../config/factory';

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

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [sales, setSalesState] = useState<Sale[]>([]);
  const [batches, setBatchesState] = useState<ProductionBatch[]>([]);
  const [stock, setStockState] = useState<StockItem[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, b, st, clients] = await Promise.all([getSales(), getBatches(), getStock(), getClients()]);
    setSalesState(s);
    setBatchesState(b);
    setStockState(st);
    setClientCount(clients.length);
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
  const tresorerie = sales
    .filter((s) => s.paymentMethod !== 'credit')
    .reduce((sum, s) => sum + s.totalAmount, 0);

  const weekBatches = batches.filter((b) => isThisWeek(b.date));
  const variableCosts = weekBatches.reduce(
    (sum, b) => sum + b.potatoesUsedKg * 1500 + b.gasUsedKg * 8000,
    0
  );
  const fixedCosts = weekBatches.length > 0 ? 200000 : 0;
  const realMargin = weekRevenue - variableCosts - fixedCosts;

  const weeklyKg = weekBatches.reduce((sum, b) => sum + b.potatoesUsedKg, 0);
  const target = FACTORY_CONFIG.weeklyProductionTarget;
  const progressPct = Math.min((weeklyKg / target) * 100, 100);

  const criticalItems = stock.filter((i) => i.currentLevel < i.alertThreshold);
  const isLosingMoney = weekRevenue > 0 && realMargin < 0;
  const dayOfWeek = new Date().getDay();
  const isProductionLate = dayOfWeek >= 3 && weeklyKg < target * 0.5;

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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.factoryName}>{FACTORY_CONFIG.name}</Text>
        <Text style={styles.headerDate}>
          {new Date().toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </Text>
      </View>

      {isLosingMoney && (
        <View style={[styles.banner, { backgroundColor: C.red }]}>
          <Text style={styles.bannerText}>⚠ Attention : vous perdez de l'argent</Text>
        </View>
      )}
      {criticalItems.map((item) => (
        <View key={item.id} style={[styles.banner, { backgroundColor: C.red }]}>
          <Text style={styles.bannerText}>⚠ Stock critique : {item.name}</Text>
        </View>
      ))}
      {isProductionLate && (
        <View style={[styles.banner, { backgroundColor: C.orange }]}>
          <Text style={styles.bannerText}>⚠ Production en retard</Text>
        </View>
      )}

      <View style={styles.revenueCard}>
        <Text style={styles.revenueLabel}>Recettes aujourd'hui</Text>
        <Text style={styles.revenueAmount}>{formatGNF(todayRevenue)}</Text>
      </View>

      <View style={styles.grid}>
        <MetricCard label="Ventes aujourd'hui" value={formatGNF(todayRevenue)} />
        <MetricCard label="Ventes cette semaine" value={formatGNF(weekRevenue)} />
        <MetricCard
          label="Marge réelle (semaine)"
          value={formatGNF(realMargin)}
          valueColor={realMargin < 0 ? C.red : C.primary}
        />
        <MetricCard label="Trésorerie" value={formatGNF(tresorerie)} />
        <MetricCard label="Nombre de clients" value={String(clientCount)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Production cette semaine</Text>
        <Text style={styles.progressText}>
          {weeklyKg} kg / {target} kg objectif
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progressPct}%` as `${number}%` }]} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ventes — 7 derniers jours</Text>
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

function MetricCard({
  label, value, valueColor,
}: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={mStyles.card}>
      <Text style={mStyles.label}>{label}</Text>
      <Text style={[mStyles.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const mStyles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E8E8E4',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  label: { fontSize: 12, color: '#6B6B66', marginBottom: 6 },
  value: { fontSize: 15, fontWeight: '600', color: '#1A1A18' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: { marginBottom: 4 },
  factoryName: { fontSize: 22, fontWeight: '700', color: C.text },
  headerDate: { fontSize: 13, color: C.muted, marginTop: 2, textTransform: 'capitalize' },
  banner: { borderRadius: 10, padding: 12 },
  bannerText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  revenueCard: {
    backgroundColor: C.primary, borderRadius: 12, padding: 20, alignItems: 'center',
  },
  revenueLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 4 },
  revenueAmount: { color: '#FFFFFF', fontSize: 32, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 10 },
  progressText: { fontSize: 13, color: C.muted, marginBottom: 8 },
  track: { height: 10, backgroundColor: '#F0F0EE', borderRadius: 5, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.primary, borderRadius: 5 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 5 },
  barCol: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: {
    flex: 1, width: '100%', justifyContent: 'flex-end',
    backgroundColor: '#F0F0EE', borderRadius: 4, overflow: 'hidden',
  },
  barFill: { width: '100%', backgroundColor: C.primary, borderRadius: 4 },
  barLabel: { fontSize: 10, color: C.muted, marginTop: 4 },
});
