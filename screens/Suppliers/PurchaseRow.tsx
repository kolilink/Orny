import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Purchase, isPurchasePaid } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

interface PurchaseRowProps {
  purchase: Purchase;
  // Hidden inside a supplier's own detail screen — the supplier name would
  // just repeat what the screen title already says.
  showSupplierName?: boolean;
  onMarkPaid: (purchase: Purchase) => void;
  onPartial: (purchase: Purchase) => void;
  onDelete?: (purchase: Purchase) => void;
  isLast?: boolean;
}

// A flat, hairline-divided row — no card border/shadow, no decorative icon
// (a cart icon repeated on every row regardless of what was bought carried
// no real information). Payment status is color only, not a label: settled
// shows nothing extra at all, still-owed just tints the amount itself —
// red is reserved for that one real signal instead of also being the
// permanent color of the delete action, which reads as constant alarm for
// no reason. Shared between the global Achats tab and the per-supplier
// detail screen, both via MonthGroup, so the two views can't drift apart.
export default function PurchaseRow({ purchase, showSupplierName = true, onMarkPaid, onPartial, onDelete, isLast = false }: PurchaseRowProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const paid = isPurchasePaid(purchase);

  return (
    <View style={[styles.row, !isLast && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.product}>{purchase.product}</Text>
        <Text style={styles.meta}>
          {showSupplierName ? `${purchase.supplierName}  ·  ` : ''}{purchase.quantity} {purchase.unit}  ·  {formatDate(purchase.date)}
        </Text>
        {!!purchase.lastPaymentAt && (
          <Text style={styles.paidCaption}>Dernier paiement : {formatDate(purchase.lastPaymentAt.split('T')[0])}</Text>
        )}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, !paid && { color: palette.critical }]}>{formatGNF(purchase.totalAmount)}</Text>
        {!paid && (
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => onPartial(purchase)} hitSlop={4}>
              <Text style={styles.partialText}>Partiel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onMarkPaid(purchase)} hitSlop={4}>
              <Text style={styles.paidActionText}>Payé ✓</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {onDelete && (
        <TouchableOpacity onPress={() => onDelete(purchase)} style={styles.deleteBtn} hitSlop={8}>
          <Ionicons name="trash-outline" size={16} color={palette.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12, gap: 8 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  product: { fontSize: 15, color: palette.ink },
  meta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  paidCaption: { fontSize: 11.5, color: palette.muted, marginTop: 3 },
  right: { alignItems: 'flex-end', gap: 6 },
  amount: { fontSize: 15, fontWeight: '700', color: palette.ink },
  actions: { flexDirection: 'row', gap: 12 },
  partialText: { fontSize: 12.5, color: palette.caution, fontWeight: '600' },
  paidActionText: { fontSize: 12.5, color: palette.moss, fontWeight: '600' },
  deleteBtn: { padding: 2, marginTop: 2 },
});
