import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getSales, updateSale, deleteSale, syncSalesFromSupabase } from '../../store/sales';
import { getFlavors, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, syncBulksFromSupabase } from '../../store/bulks';
import { useAuth } from '../../context/AuthContext';
import { Sale, ProductFlavor, BulkProduct, saleDebt } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, PressableScale, FadeSlideIn, Text } from '../../components/ui';

const PAYMENT_LABELS: Record<Sale['paymentMethod'], string> = {
  cash: 'Cash',
  orange_money: 'Orange Money',
  credit: 'Crédit',
};

// orange_money references Orange Money's own real-world brand color
// deliberately, not the app's caution/critical tokens — see the same note
// in screens/Reports/index.tsx and screens/Ventes/index.tsx.
const ORANGE_MONEY_BRAND = '#EF9F27';

const makePaymentColors = (palette: Palette): Record<Sale['paymentMethod'], string> => ({
  cash: palette.moss,
  orange_money: ORANGE_MONEY_BRAND,
  credit: palette.violet,
});

type Filter = 'all' | 'paid' | 'due';

// "Mercredi 19 août" — weekday + day + month, no year (the group header
// only ever spans a handful of recent weeks, so the year is implied).
function dayGroupLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Sales history — day-grouped and filterable, matching the pattern Patron's
// own sales-history screen uses (2026-09-05, direct request against a
// side-by-side comparison). Split out of screens/Ventes/index.tsx (see that
// file's own note) so the Ventes tab stays purely the sell action.
//
// Deliberately NOT a byte-for-byte port — three real differences from
// Patron's own screen, kept because the underlying data actually differs:
// (1) each `Sale` row here is already one product line (a multi-product
// checkout writes one row per item, not one order + several lines), so a
// day group's "sub-row" is already a single line item, never a multi-item
// receipt to expand further; the detail view's own "Article" section
// mirrors that — one line, not a list. (2) there is no discount/"rabais"
// concept on this table, so no discount line is shown. (3) there is no
// cancellation status for a sale here (only delete), so the filter chips
// are Tout/Payés/À payer, not Patron's four-way Tout/Payés/À payer/Annulés.
// A "Partager le reçu" share action and a floating "+" shortcut back into
// the sell flow were both deliberately left out too — receipt image sharing
// doesn't exist anywhere in this app yet (a real, separate feature, not a
// restyle), and a second add-sale entry point here would undercut the same
// "Ventes tab is the one place you sell" decision made earlier this session.
export default function SalesHistoryScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const PAYMENT_COLORS = makePaymentColors(palette);
  const { getMembers } = useAuth();

  const [sales, setSalesState] = useState<Sale[]>([]);
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [detailSale, setDetailSale] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editForm, setEditForm] = useState<{
    clientName: string; quantity: number; unitPrice: number;
    paymentMethod: Sale['paymentMethod'];
  } | null>(null);

  // Cache-first: render the history list instantly from local cache, then
  // sync sales/flavors/bulks in the background and re-render once the
  // fresh data lands — this used to block the whole screen on the network
  // sync before showing a single row.
  const load = useCallback(async () => {
    const [s, fl, bk, members] = await Promise.all([getSales(), getFlavors(), getBulks(), getMembers()]);
    setSalesState(s);
    setFlavorsState(fl);
    setBulksState(bk);
    const names: Record<string, string> = {};
    members.forEach((m) => { names[m.userId] = m.displayName || m.email; });
    setMemberNames(names);

    await Promise.all([syncSalesFromSupabase(), syncFlavorsFromSupabase(), syncBulksFromSupabase()]);
    const [freshS, freshFl, freshBk] = await Promise.all([getSales(), getFlavors(), getBulks()]);
    setSalesState(freshS);
    setFlavorsState(freshFl);
    setBulksState(freshBk);
  }, [getMembers]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const getProductLabel = (sale: Sale): string => {
    if (sale.productType === 'bulk') {
      return bulks.find((b) => b.id === sale.product)?.name ?? sale.product;
    }
    return flavors.find((f) => f.id === sale.product)?.label ?? sale.product;
  };

  const filteredSales = useMemo(() => {
    if (filter === 'paid') return sales.filter((s) => saleDebt(s) === 0);
    if (filter === 'due') return sales.filter((s) => saleDebt(s) > 0);
    return sales;
  }, [sales, filter]);

  const dayGroups = useMemo(() => {
    const map = new Map<string, Sale[]>();
    for (const s of filteredSales) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => ({
        date,
        items,
        total: items.reduce((sum, s) => sum + s.totalAmount, 0),
      }));
  }, [filteredSales]);

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const handleMarkPaid = async (sale: Sale) => {
    await updateSale(sale.id, { amountPaid: sale.totalAmount });
    await load();
    setDetailSale(null);
  };

  const openEdit = (sale: Sale) => {
    setEditingSale(sale);
    setEditForm({
      clientName: sale.clientName,
      quantity: sale.quantity,
      unitPrice: sale.unitPrice,
      paymentMethod: sale.paymentMethod,
    });
    setDetailSale(null);
  };

  const handleUpdate = async () => {
    if (!editingSale || !editForm) return;
    setSaving(true);
    try {
      const newTotal = editForm.quantity * editForm.unitPrice;
      const amountPaid = editForm.paymentMethod !== 'credit' ? newTotal : (editingSale.amountPaid ?? 0);
      await updateSale(editingSale.id, {
        clientName: editForm.clientName,
        quantity: editForm.quantity,
        unitPrice: editForm.unitPrice,
        totalAmount: newTotal,
        amountPaid,
        paymentMethod: editForm.paymentMethod,
      });
      await load();
      setEditingSale(null);
      setEditForm(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (sale: Sale) => {
    setDetailSale(null);
    setDeleteTarget(sale);
  };

  const detailDebt = detailSale ? saleDebt(detailSale) : 0;
  const detailProfit = detailSale && detailSale.costAmount != null
    ? detailSale.totalAmount - detailSale.costAmount
    : null;
  const detailProfitPct = detailProfit != null && detailSale && detailSale.totalAmount > 0
    ? (detailProfit / detailSale.totalAmount) * 100
    : null;
  const detailVendor = detailSale?.createdBy ? memberNames[detailSale.createdBy] : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {([
          { key: 'all', label: 'Tout' },
          { key: 'paid', label: 'Payés' },
          { key: 'due', label: 'À payer' },
        ] as const).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={dayGroups.length > 0 ? styles.listContent : styles.listEmpty}>
        {dayGroups.length === 0 && (
          <Text style={styles.empty}>Aucune vente enregistrée.</Text>
        )}
        {dayGroups.map((group, groupIndex) => {
          const isOpen = expandedDays.has(group.date);
          return (
            <FadeSlideIn key={group.date} index={groupIndex} style={styles.dayGroup}>
              <PressableScale style={styles.dayHeader} onPress={() => toggleDay(group.date)}>
                <View>
                  <Text style={styles.dayLabel}>{dayGroupLabel(group.date)}</Text>
                  <Text style={styles.dayCount}>
                    {group.items.length} vente{group.items.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.dayTotal}>{formatGNF(group.total)}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
                </View>
              </PressableScale>
              {isOpen && (
                <View style={styles.dayItems}>
                  {group.items.map((item, i) => {
                    const debt = saleDebt(item);
                    const amountColor = debt > 0 ? palette.caution : palette.moss;
                    const vendor = item.createdBy ? memberNames[item.createdBy] : undefined;
                    return (
                      <FadeSlideIn key={item.id} index={i}>
                        <PressableScale
                          style={[styles.saleRow, i > 0 && styles.saleRowDivider]}
                          onPress={() => setDetailSale(item)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.saleClient}>{item.clientName}</Text>
                            <Text style={styles.saleMeta}>{getProductLabel(item)} · {item.quantity}×</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.saleAmount, { color: amountColor }]}>{formatGNF(item.totalAmount)}</Text>
                            {vendor && <Text style={[styles.saleVendor, { color: amountColor }]}>Vendeur : {vendor}</Text>}
                            {debt > 0 && <Text style={styles.debtBadge}>Doit {formatGNF(debt)}</Text>}
                          </View>
                        </PressableScale>
                      </FadeSlideIn>
                    );
                  })}
                </View>
              )}
            </FadeSlideIn>
          );
        })}
      </ScrollView>

      {/* Detail modal */}
      <AppModal visible={!!detailSale} onClose={() => setDetailSale(null)} title={detailSale ? `Vente du ${formatDate(detailSale.date)}` : ''}>
        {detailSale && (
          <>
            <View style={[styles.statusBanner, { backgroundColor: detailDebt > 0 ? palette.cautionSoft : palette.mossSoft }]}>
              <Ionicons name={detailDebt > 0 ? 'time-outline' : 'checkmark-circle'} size={16} color={detailDebt > 0 ? palette.caution : palette.moss} />
              <Text style={[styles.statusBannerText, { color: detailDebt > 0 ? palette.caution : palette.moss }]}>
                {detailDebt > 0 ? `Reste à payer : ${formatGNF(detailDebt)}` : 'Payé en entier'}
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Article</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardRowLabel}>{getProductLabel(detailSale)} ×{detailSale.quantity}</Text>
                <Text style={styles.cardRowValue}>{formatGNF(detailSale.totalAmount)}</Text>
              </View>
            </View>

            {detailVendor && (
              <>
                <Text style={styles.sectionLabel}>Vendeur</Text>
                <View style={styles.card}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardRowValue}>{detailVendor}</Text>
                  </View>
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>Paiement reçu</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardRowLabel}>{PAYMENT_LABELS[detailSale.paymentMethod] ?? detailSale.paymentMethod}</Text>
                <Text style={styles.cardRowValue}>{formatGNF(detailSale.amountPaid ?? 0)}</Text>
              </View>
              {detailDebt > 0 && (
                <View style={[styles.cardRow, styles.cardRowBorder]}>
                  <Text style={[styles.cardRowLabel, { color: palette.critical }]}>Montant dû</Text>
                  <Text style={[styles.cardRowValue, { color: palette.critical }]}>{formatGNF(detailDebt)}</Text>
                </View>
              )}
            </View>

            {detailProfit != null && (
              <>
                <Text style={styles.sectionLabel}>Bénéfice</Text>
                <View style={styles.card}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardRowLabel}>Coût d'achat</Text>
                    <Text style={styles.cardRowValue}>{formatGNF(detailSale.costAmount!)}</Text>
                  </View>
                  <View style={[styles.cardRow, styles.cardRowBorder]}>
                    <Text style={[styles.cardRowLabel, { fontWeight: '700', color: palette.ink }]}>Bénéfice net</Text>
                    <Text style={[styles.cardRowValue, { fontWeight: '700', color: detailProfit >= 0 ? palette.moss : palette.critical }]}>
                      {detailProfit >= 0 ? '+' : ''}{formatGNF(detailProfit)}{detailProfitPct != null ? ` (${detailProfitPct.toFixed(0)}%)` : ''}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {detailSale.paymentMethod === 'credit' && detailDebt > 0 && (
              <TouchableOpacity style={styles.markPaidBtn} onPress={() => handleMarkPaid(detailSale)}>
                <Ionicons name="checkmark-circle-outline" size={18} color={palette.moss} />
                <Text style={styles.markPaidText}>Marquer comme payé</Text>
              </TouchableOpacity>
            )}

            <View style={styles.detailActions}>
              <TouchableOpacity style={styles.editDetailBtn} onPress={() => openEdit(detailSale)}>
                <Ionicons name="pencil-outline" size={16} color={palette.moss} />
                <Text style={styles.editDetailText}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteDetailBtn} onPress={() => handleDelete(detailSale)}>
                <Ionicons name="trash-outline" size={16} color={palette.critical} />
                <Text style={styles.deleteDetailText}>Supprimer</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </AppModal>

      {/* Delete confirm */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteSale(deleteTarget.id);
          await load();
          setDeleteTarget(null);
        }}
        title="Supprimer cette vente ?"
        message={deleteTarget ? `${deleteTarget.clientName} — ${formatGNF(deleteTarget.totalAmount)}` : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Edit modal */}
      <AppModal visible={!!editingSale} onClose={() => setEditingSale(null)} title="Modifier la vente">
        {editForm && (
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.editLabel}>Client</Text>
            <TextInput
              style={styles.editInput}
              value={editForm.clientName}
              onChangeText={(v) => setEditForm((f) => f ? { ...f, clientName: v } : f)}
            />
            <Text style={styles.editLabel}>Quantité</Text>
            <TextInput
              style={styles.editInput}
              keyboardType="numeric"
              value={String(editForm.quantity)}
              onChangeText={(v) => setEditForm((f) => f ? { ...f, quantity: parseInt(v) || 1 } : f)}
            />
            <Text style={styles.editLabel}>Prix unitaire (GNF)</Text>
            <MoneyInput
              style={styles.editInput}
              value={String(editForm.unitPrice)}
              onChangeText={(v) => setEditForm((f) => f ? { ...f, unitPrice: parseInt(v) || 0 } : f)}
            />
            <Text style={styles.editLabel}>Mode de paiement</Text>
            <View style={styles.paymentRow}>
              {(Object.keys(PAYMENT_LABELS) as Sale['paymentMethod'][]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.payBtn, editForm.paymentMethod === m && { backgroundColor: PAYMENT_COLORS[m] }]}
                  onPress={() => setEditForm((f) => f ? { ...f, paymentMethod: m } : f)}
                >
                  <Text style={[styles.payBtnText, editForm.paymentMethod === m && { color: palette.white }]}>
                    {PAYMENT_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.totalBox, { marginTop: 12 }]}>
              Total : {formatGNF(editForm.quantity * editForm.unitPrice)}
            </Text>
            <View style={styles.modalActionsRow}>
              <Button label="Annuler" variant="ghost" onPress={() => setEditingSale(null)} style={{ flex: 1 }} />
              <Button label="Enregistrer" onPress={handleUpdate} loading={saving} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        )}
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
  },
  filterChipActive: { backgroundColor: palette.moss, borderColor: palette.moss },
  filterChipText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  filterChipTextActive: { color: palette.white },
  listContent: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  listEmpty: { flexGrow: 1, padding: 16 },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15 },
  dayGroup: { marginBottom: 4 },
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12,
  },
  dayLabel: { fontSize: 15, fontWeight: '600', color: palette.ink },
  dayCount: { fontSize: 12.5, color: palette.muted, marginTop: 2 },
  dayTotal: { fontSize: 14, fontWeight: '600', color: palette.ink },
  dayItems: {
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden', marginBottom: 8,
  },
  saleRow: { flexDirection: 'row', padding: 14 },
  saleRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  saleClient: { fontSize: 15, fontWeight: '600', color: palette.ink },
  saleMeta: { fontSize: 13, color: palette.muted, marginTop: 2 },
  saleAmount: { fontSize: 15, fontWeight: '700' },
  saleVendor: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  debtBadge: { fontSize: 11, color: palette.critical, fontWeight: '600', marginTop: 2 },
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  statusBannerText: { fontSize: 15, fontWeight: '700' },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: palette.muted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 12,
  },
  card: {
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14,
  },
  cardRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  cardRowLabel: { fontSize: 14, color: palette.muted },
  cardRowValue: { fontSize: 14, fontWeight: '600', color: palette.ink },
  markPaidBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.mossSoft, borderRadius: 10, padding: 12, marginTop: 16,
    borderWidth: 1, borderColor: palette.moss + '40',
  },
  markPaidText: { fontSize: 15, fontWeight: '600', color: palette.moss },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: palette.mossSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  editDetailText: { fontSize: 14, fontWeight: '600', color: palette.moss },
  deleteDetailBtn: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: palette.criticalSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  deleteDetailText: { fontSize: 14, fontWeight: '600', color: palette.critical },
  editLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  editInput: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payBtn: {
    flex: 1, minWidth: '30%', height: 52, borderRadius: 12,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  payBtnText: { fontSize: 14, fontWeight: '600', color: palette.ink },
  totalBox: {
    backgroundColor: palette.mossSoft, borderRadius: 12, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: palette.moss + '40',
    fontSize: 16, fontWeight: '600', color: palette.moss, textAlign: 'center',
  } as any,
  modalActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
