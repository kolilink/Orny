import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, ConfirmDialog, Text } from '../../components/ui';
import { radius, spacing, typography, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { clearNotificationLog, getNotificationLog, LoggedNotification, NotificationKind } from '../../utils/notificationLog';

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  stock: 'cube-outline',
  predictive_stock: 'trending-down-outline',
  orders: 'clipboard-outline',
  ai: 'sparkles-outline',
};

const makeKindColor = (palette: Palette): Record<NotificationKind, string> => ({
  stock: palette.critical,
  predictive_stock: palette.caution,
  orders: palette.caution,
  ai: palette.moss,
});

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const KIND_COLOR = makeKindColor(palette);
  const [log, setLog] = useState<LoggedNotification[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    getNotificationLog().then(setLog);
  }, []);

  useFocusEffect(load);

  async function doClear() {
    setConfirmClear(false);
    await clearNotificationLog();
    setLog([]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {log.length > 0 ? (
          <TouchableOpacity onPress={() => setConfirmClear(true)} hitSlop={8}>
            <Text style={styles.clearText}>Effacer</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <FlatList
        data={log}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: KIND_COLOR[item.kind] + '1A' }]}>
              <Ionicons name={KIND_ICON[item.kind]} size={20} color={KIND_COLOR[item.kind]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={40} color={palette.line} />
            <Text style={styles.emptyText}>Aucune alerte pour l'instant</Text>
          </View>
        }
      />

      <ConfirmDialog
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={doClear}
        title="Effacer l'historique ?"
        message="Cette action ne peut pas être annulée."
        confirmLabel="Effacer"
        cancelLabel="Annuler"
        icon="trash-outline"
        tone="danger"
      />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.screenTitle, color: palette.ink },
  clearText: { color: palette.critical, fontSize: 14, fontWeight: '600' },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.bodyBold, color: palette.ink, marginBottom: 2 },
  body: { ...typography.body, color: palette.muted, lineHeight: 19 },
  time: { ...typography.caption, color: palette.muted, marginTop: spacing.xs },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.md },
  emptyText: { ...typography.body, color: palette.muted },
});
