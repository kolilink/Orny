import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Text } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { Palette, radius, spacing, tabularNums, typography } from '../../theme/tokens';
import { getSales } from '../../store/sales';
import { getBatches } from '../../store/batches';
import { getStock } from '../../store/stock';
import { getPendingCount } from '../../lib/syncQueue';
import { summarizeFactoryDay, FactoryDaySummary } from '../../lib/factoryToday';
import { toDateString } from '../../utils/dates';
import { formatGNF, formatNumber } from '../../utils/format';

// "Aujourd'hui" — the first screen dad sees.
//
// First principles, not a dashboard: one question only — how is the
// factory going today? Four answers, in plain French, big enough to read
// at a glance, in light mode and in dark mode (palette comes from
// useTheme, never a hardcoded color here).
//
// Offline-first by construction: this screen reads ONLY the on-device
// cache. No sync call, no network wait, no spinner while Guinea's
// connection catches up. If a sale was recorded offline, it is already
// in the cache, so it is already here. The pending-sync line at the
// bottom is the honest part: it says how many writes are still waiting
// for a connection, instead of pretending everything went through.
export default function TodayScreen() {
  const { palette, resolvedScheme, setColorScheme } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [summary, setSummary] = useState<FactoryDaySummary | null>(null);

  const load = useCallback(async () => {
    const [sales, batches, stock, pending] = await Promise.all([
      getSales(),
      getBatches(),
      getStock(),
      getPendingCount(),
    ]);
    setSummary(summarizeFactoryDay(sales, batches, stock, pending, toDateString()));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const s = summary;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Aujourd'hui</Text>
          <Text style={styles.subtitle}>Comment va l'usine ?</Text>
        </View>
        {/* Dad-visible theme switch, on the first screen — not buried in
            Profile. One tap toggles light/dark; the full Clair/Sombre/
            Système choice still lives in Profile. */}
        <TouchableOpacity
          style={styles.themeToggle}
          onPress={() => setColorScheme(resolvedScheme === 'dark' ? 'light' : 'dark')}
          accessibilityLabel={resolvedScheme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
        >
          <Ionicons name={resolvedScheme === 'dark' ? 'sunny' : 'moon'} size={20} color={palette.mossDeep} />
        </TouchableOpacity>
      </View>

      <Card style={styles.card}>
        <Text style={styles.label}>VENDU AUJOURD'HUI</Text>
        <Text style={styles.big}>
          {s ? `${formatNumber(s.todaySalesUnits)} sachets` : '—'}
        </Text>
        <Text style={styles.value}>{s ? formatGNF(s.todayCollectedGNF) : '—'} encaissés</Text>
        <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Ventes')}>
          <Text style={styles.actionText}>Vendre →</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>PRODUIT AUJOURD'HUI</Text>
        <Text style={styles.big}>
          {s ? `${formatNumber(s.todayProducedUnits)} sachets` : '—'}
        </Text>
        <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Production')}>
          <Text style={styles.actionText}>Produire →</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>STOCK EN ALERTE</Text>
        <Text style={[styles.big, s && s.lowStockCount > 0 ? styles.amber : null]}>
          {s ? String(s.lowStockCount) : '—'}
        </Text>
        <Text style={styles.value}>
          {s ? (s.lowStockCount === 0 ? 'Rien à signaler' : s.lowStockNames.join(', ')) : '—'}
        </Text>
        <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Stock')}>
          <Text style={styles.actionText}>Voir le stock →</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>À RÉCUPÉRER (CRÉDITS)</Text>
        <Text style={[styles.big, s && s.creditOutstandingGNF > 0 ? styles.red : null]}>
          {s ? formatGNF(s.creditOutstandingGNF) : '—'}
        </Text>
        <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Clients')}>
          <Text style={styles.actionText}>Voir les clients →</Text>
        </TouchableOpacity>
      </Card>

      {s && s.pendingSync > 0 ? (
        <View style={styles.pending}>
          <Ionicons name="cloud-offline-outline" size={18} color={palette.caution} />
          <Text style={styles.pendingText}>
            {s.pendingSync} modification{s.pendingSync > 1 ? 's' : ''} en attente de connexion
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  themeToggle: { padding: 10, borderRadius: radius.pill, backgroundColor: palette.mossSoft },
  title: { ...typography.hero, color: palette.ink },
  subtitle: { ...typography.body, color: palette.muted, marginBottom: spacing.sm },
  card: { gap: 4 },
  label: { ...typography.eyebrow, color: palette.muted },
  big: { ...typography.heroNumber, ...tabularNums, color: palette.ink },
  value: { ...typography.body, color: palette.ink },
  amber: { color: palette.caution },
  red: { color: palette.critical },
  action: { marginTop: spacing.sm, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: palette.mossSoft },
  actionText: { ...typography.bodyBold, color: palette.mossDeep },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
  pendingText: { ...typography.body, color: palette.caution },
});
