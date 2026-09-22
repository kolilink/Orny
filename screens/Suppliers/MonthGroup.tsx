import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Purchase } from '../../types';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import PurchaseRow from './PurchaseRow';

interface MonthGroupProps {
  purchases: Purchase[];
  showSupplierName?: boolean;
  onMarkPaid: (purchase: Purchase) => void;
  onPartial: (purchase: Purchase) => void;
  onDelete?: (purchase: Purchase) => void;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Buckets a purchase list into collapsible per-month sections instead of one
// long flat list of bordered cards — tap a month to see its purchases. Used
// by both the global Achats tab and the per-supplier detail screen so the
// two never present the same data differently.
export default function MonthGroup({ purchases, showSupplierName, onMarkPaid, onPartial, onDelete }: MonthGroupProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, Purchase[]>();
    for (const p of purchases) {
      const key = p.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => ({
        key,
        items,
        total: items.reduce((sum, p) => sum + p.totalAmount, 0),
      }));
  }, [purchases]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <View>
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        return (
          <View key={group.key} style={styles.group}>
            <TouchableOpacity style={styles.header} onPress={() => toggle(group.key)} activeOpacity={0.7}>
              <View>
                <Text style={styles.monthLabel}>{monthLabel(group.key)}</Text>
                <Text style={styles.count}>{group.items.length} achat{group.items.length > 1 ? 's' : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.total}>{formatGNF(group.total)}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
              </View>
            </TouchableOpacity>
            {isOpen && (
              <View style={styles.items}>
                {group.items.map((p, i) => (
                  <PurchaseRow
                    key={p.id}
                    purchase={p}
                    showSupplierName={showSupplierName}
                    onMarkPaid={onMarkPaid}
                    onPartial={onPartial}
                    onDelete={onDelete}
                    isLast={i === group.items.length - 1}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  monthLabel: { fontSize: 15, fontWeight: '600', color: palette.ink },
  count: { fontSize: 12.5, color: palette.muted, marginTop: 2 },
  total: { fontSize: 14, fontWeight: '600', color: palette.ink },
  items: { paddingBottom: 4 },
});
