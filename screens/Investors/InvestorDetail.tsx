import React, { useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import {
  getInvestors, updateInvestor, deleteInvestor,
} from '../../store/investors';
import {
  getInvestmentEntries, addInvestmentEntry, updateInvestmentEntry, deleteInvestmentEntry, getEntryEditHistory,
} from '../../store/investmentEntries';
import { getDistributions, addDistribution, deleteDistribution } from '../../store/investorDistributions';
import { Investor, InvestmentEntry, InvestorDistribution, EditHistoryEntry, RootStackParamList } from '../../types';
import { formatGNF, formatNumber, formatDate } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import DatePickerField from '../../components/DatePickerField';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, switchModal, toast, Text } from '../../components/ui';
import { getUsdToGnfRate } from '../../lib/exchangeRate';

// ── Edit rate-limiting: 3 edits per 24h rolling window from first edit ──────
const MAX_EDITS = 3;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function editKey(entryId: string) { return `entry_edits_${entryId}`; }

async function getRecentEdits(entryId: string): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(editKey(entryId));
    if (!raw) return [];
    const all: number[] = JSON.parse(raw);
    return all.filter(t => Date.now() - t < EDIT_WINDOW_MS);
  } catch { return []; }
}

async function checkEditAllowed(entryId: string): Promise<{ allowed: boolean; remaining: number; hoursUntilReset: number }> {
  const recent = await getRecentEdits(entryId);
  if (recent.length >= MAX_EDITS) {
    const oldest = Math.min(...recent);
    const hoursUntilReset = Math.ceil((oldest + EDIT_WINDOW_MS - Date.now()) / 3_600_000);
    return { allowed: false, remaining: 0, hoursUntilReset };
  }
  return { allowed: true, remaining: MAX_EDITS - recent.length, hoursUntilReset: 0 };
}

async function recordEdit(entryId: string): Promise<number> {
  const recent = await getRecentEdits(entryId);
  const updated = [...recent, Date.now()];
  await AsyncStorage.setItem(editKey(entryId), JSON.stringify(updated));
  return Math.max(0, MAX_EDITS - updated.length);
}

// This screen has 9 separate AppModal/ConfirmDialog instances and several
// handlers that close one and directly open another (the overflow menu →
// edit/delete, the movement row menu → history/edit/delete) — each one
// exposed to the AppModal-stacking freeze risk (see switchModal's own
// comment in components/ui/AppModal.tsx). Fixed by routing every such
// transition through switchModal instead of merging all 9 into one shared
// view-swap component — smaller, more contained change for a screen this
// dense with modals.

type InvestorForm = { name: string; share: string; notes: string };
// currency only ever matters on the "Ajouter un apport" (new entry) flow —
// editing an existing entry and withdrawals both stay GNF-only, see the
// comments at their own call sites for why.
type EntryForm = { amount: string; date: string; notes: string; currency: 'GNF' | 'USD' };
const EMPTY_ENTRY: EntryForm = { amount: '', date: toDateString(), notes: '', currency: 'GNF' };

type DetailNav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'InvestorDetail'>;

// One investor's account: how much they've brought in, when, and what share
// of the real (capital-weighted) total that represents — computed, never
// something the founder has to work out by hand. Mirrors SupplierDetail's
// shape exactly: a centered hero with the numbers that matter up front, a
// flat history of movements, a "•••" overflow instead of always-visible
// icons, and a single pinned action.
export default function InvestorDetailScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation<DetailNav>();
  const { params } = useRoute<DetailRoute>();
  const insets = useSafeAreaInsets();
  const { membership } = useAuth();
  // Manager gets the same write access as admin here (db/update27.sql) —
  // managing investor capital entries is explicitly part of "admin minus
  // ownership actions," unlike the team/factory-settings actions that stay
  // admin-only elsewhere in the app.
  const canManage = membership?.role === 'admin' || membership?.role === 'manager';

  const [investor, setInvestor] = useState<Investor | null>(null);
  const [entries, setEntries] = useState<InvestmentEntry[]>([]);
  const [distributions, setDistributions] = useState<InvestorDistribution[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);

  const [menuVisible, setMenuVisible] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState<InvestorForm>({ name: '', share: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteInvestorConfirm, setDeleteInvestorConfirm] = useState(false);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<InvestmentEntry | null>(null);
  const [entryForm, setEntryForm] = useState<EntryForm>(EMPTY_ENTRY);
  const [editRemaining, setEditRemaining] = useState(MAX_EDITS);

  // Live USD->GNF preview for the "Ajouter un apport" form — re-fetched
  // whenever the chosen date changes (the rate depends only on the date,
  // never on the typed amount, so amount keystrokes don't re-fetch). Shown
  // before saving so the conversion is visible and checkable, not a black
  // box the user has to trust blindly — see lib/exchangeRate.ts for the
  // actual data source and fallback behavior.
  const [entryRate, setEntryRate] = useState<{ rate: number; dateUsed: string } | null>(null);
  const [entryRateLoading, setEntryRateLoading] = useState(false);
  useEffect(() => {
    if (!showEntryModal || editingEntry || entryForm.currency !== 'USD') {
      setEntryRate(null);
      return;
    }
    let cancelled = false;
    setEntryRateLoading(true);
    getUsdToGnfRate(entryForm.date).then((r) => {
      if (!cancelled) setEntryRate(r);
    }).finally(() => {
      if (!cancelled) setEntryRateLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEntryModal, editingEntry, entryForm.currency, entryForm.date]);

  const [showDistModal, setShowDistModal] = useState(false);
  const [distForm, setDistForm] = useState<EntryForm>(EMPTY_ENTRY);

  const [entryActionsTarget, setEntryActionsTarget] = useState<
    { kind: 'entry'; item: InvestmentEntry } | { kind: 'dist'; item: InvestorDistribution } | null
  >(null);
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<InvestmentEntry | null>(null);
  const [deleteDistTarget, setDeleteDistTarget] = useState<InvestorDistribution | null>(null);

  const [historyTarget, setHistoryTarget] = useState<InvestmentEntry | null>(null);
  const [historyItems, setHistoryItems] = useState<EditHistoryEntry<Partial<InvestmentEntry>>[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    const [allInvestors, allEntries, allDist] = await Promise.all([
      getInvestors(), getInvestmentEntries(), getDistributions(),
    ]);
    const found = allInvestors.find((i) => i.id === params.investorId) ?? null;
    setInvestor(found);
    setEntries(allEntries.filter((e) => e.investorId === params.investorId));
    setDistributions(allDist.filter((d) => d.investorId === params.investorId));

    const totalFor = (inv: Investor) => {
      const eSum = allEntries.filter((e) => e.investorId === inv.id).reduce((s, e) => s + e.amount, 0);
      const dSum = allDist.filter((d) => d.investorId === inv.id).reduce((s, d) => s + d.amount, 0);
      return inv.amountInvested + eSum - dSum;
    };
    setGrandTotal(allInvestors.reduce((s, inv) => s + totalFor(inv), 0));
  }, [params.investorId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    if (investor) navigation.setOptions({ title: investor.name });
    navigation.setOptions({
      headerRight: () => canManage ? (
        <TouchableOpacity onPress={() => setMenuVisible(true)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={22} color={palette.moss} />
        </TouchableOpacity>
      ) : null,
    });
  }, [navigation, investor, canManage, palette.moss]);

  function openEdit() {
    if (!investor) return;
    setEditForm({ name: investor.name, share: String(investor.sharePercentage), notes: investor.notes ?? '' });
    setEditModal(true);
  }

  async function handleSaveEdit() {
    if (!investor || !editForm.name.trim()) return;
    setSaving(true);
    try {
      await updateInvestor(investor.id, {
        name: editForm.name.trim(),
        sharePercentage: parseFloat(editForm.share) || 0,
        notes: editForm.notes.trim(),
      });
      setEditModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteInvestor() {
    if (!investor) return;
    await deleteInvestor(investor.id);
    await Promise.all(entries.map((e) => deleteInvestmentEntry(e.id)));
    setDeleteInvestorConfirm(false);
    navigation.goBack();
  }

  function openAddEntry() {
    setEditingEntry(null);
    setEntryForm(EMPTY_ENTRY);
    setShowEntryModal(true);
  }

  async function openEditEntry(entry: InvestmentEntry) {
    const { allowed, remaining, hoursUntilReset } = await checkEditAllowed(entry.id);
    if (!allowed) {
      toast.warning(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`);
      return;
    }
    setEditRemaining(remaining);
    setEditingEntry(entry);
    // Editing always operates in GNF terms regardless of the entry's
    // original currency — the stored `amount` is already GNF, and
    // re-deriving a historical FX rate for a correction (rate-limited to
    // 3/24h, meant for typo fixes) is unnecessary complexity for what this
    // is actually for. currency stays 'GNF' here on purpose; the picker
    // below is hidden whenever editingEntry is set.
    setEntryForm({ amount: String(entry.amount), date: entry.date, notes: entry.notes ?? '', currency: 'GNF' });
    setShowEntryModal(true);
  }

  async function handleSaveEntry() {
    if (!investor) return;
    const typed = parseFloat(entryForm.amount) || 0;
    if (typed <= 0) return;
    setSaving(true);
    try {
      if (editingEntry) {
        await updateInvestmentEntry(editingEntry.id, { amount: typed, date: entryForm.date, notes: entryForm.notes.trim() || undefined });
        const remaining = await recordEdit(editingEntry.id);
        await load();
        setShowEntryModal(false);
        if (remaining === 0) {
          const { hoursUntilReset } = await checkEditAllowed(editingEntry.id);
          toast.warning(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`);
        } else {
          toast.success(`Il vous reste ${remaining} modification${remaining > 1 ? 's' : ''} dans les 24h`);
        }
      } else if (entryForm.currency === 'USD') {
        // Reuse the already-fetched preview rate if it matches the date
        // still selected (the common case — nothing changed between
        // preview and tap); otherwise fetch fresh rather than trust a
        // stale/mismatched preview.
        const resolved = entryRate?.dateUsed === entryForm.date ? entryRate : await getUsdToGnfRate(entryForm.date);
        if (!resolved) {
          toast.warning("Impossible de récupérer le taux de change. Réessayez dans un instant.");
          return;
        }
        const gnf = Math.round(typed * resolved.rate);
        await addInvestmentEntry({
          investorId: investor.id, amount: gnf, date: entryForm.date, notes: entryForm.notes.trim() || undefined,
          currency: 'USD', originalAmount: typed, exchangeRate: resolved.rate,
        });
        await load();
        setShowEntryModal(false);
      } else {
        await addInvestmentEntry({ investorId: investor.id, amount: typed, date: entryForm.date, notes: entryForm.notes.trim() || undefined, currency: 'GNF' });
        await load();
        setShowEntryModal(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteEntry() {
    if (!deleteEntryTarget) return;
    await deleteInvestmentEntry(deleteEntryTarget.id);
    setDeleteEntryTarget(null);
    await load();
  }

  async function handleSaveDistribution() {
    if (!investor) return;
    const amount = parseFloat(distForm.amount) || 0;
    if (amount <= 0) return;
    setSaving(true);
    try {
      await addDistribution({ investorId: investor.id, amount, date: distForm.date, notes: distForm.notes.trim() || undefined });
      await load();
      setShowDistModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteDistribution() {
    if (!deleteDistTarget) return;
    await deleteDistribution(deleteDistTarget.id);
    setDeleteDistTarget(null);
    await load();
  }

  async function openHistory(entry: InvestmentEntry) {
    setHistoryTarget(entry);
    setHistoryLoading(true);
    const items = await getEntryEditHistory(entry.id);
    setHistoryItems(items);
    setHistoryLoading(false);
  }

  if (!investor) {
    return <View style={styles.container} />;
  }

  const total = investor.amountInvested
    + entries.reduce((s, e) => s + e.amount, 0)
    - distributions.reduce((s, d) => s + d.amount, 0);
  const capitalShare = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
  const totalDistributed = distributions.reduce((s, d) => s + d.amount, 0);

  // Chronological movement list — rare events for one person, so no month
  // grouping the way Suppliers' frequent purchases need; everything just
  // shown newest-first with its own date, satisfying "when that was"
  // directly instead of asking anyone to look it up.
  type Movement = { kind: 'base' | 'entry' | 'dist'; date: string; amount: number; note?: string; ref?: InvestmentEntry | InvestorDistribution };
  const movements: Movement[] = [
    ...(investor.amountInvested > 0 ? [{ kind: 'base' as const, date: investor.dateAdded.split('T')[0], amount: investor.amountInvested, note: 'Investissement de base' }] : []),
    ...entries.map((e) => ({ kind: 'entry' as const, date: e.date, amount: e.amount, note: e.notes, ref: e })),
    ...distributions.map((d) => ({ kind: 'dist' as const, date: d.date, amount: d.amount, note: d.notes || 'Retrait effectué', ref: d })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{investor.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{investor.name}</Text>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Total investi</Text>
              <Text style={styles.heroStatValue}>{formatGNF(total)}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Part du capital</Text>
              <Text style={[styles.heroStatValue, { color: palette.moss }]}>{capitalShare.toFixed(1)}%</Text>
            </View>
          </View>

          {investor.sharePercentage > 0 && (
            <Text style={styles.caption}>Part fixée : {investor.sharePercentage}%</Text>
          )}
          {totalDistributed > 0 && (
            <Text style={styles.caption}>Total distribué : {formatGNF(totalDistributed)}</Text>
          )}
          {!!investor.notes && <Text style={styles.caption}>{investor.notes}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Historique</Text>
        {movements.length === 0 ? (
          <Text style={styles.empty}>Aucun apport enregistré</Text>
        ) : (
          <View style={styles.movementsList}>
            {movements.map((m, i) => {
              const isLast = i === movements.length - 1;
              const canTap = canManage && m.kind !== 'base';
              return (
                <TouchableOpacity
                  key={m.ref?.id ?? 'base'}
                  style={[styles.movementRow, !isLast && styles.rowDivider]}
                  disabled={!canTap}
                  onPress={() => {
                    if (!canTap || !m.ref) return;
                    setEntryActionsTarget(m.kind === 'entry'
                      ? { kind: 'entry', item: m.ref as InvestmentEntry }
                      : { kind: 'dist', item: m.ref as InvestorDistribution });
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.movementAmount, m.kind === 'dist' && { color: palette.caution }]}>
                      {m.kind === 'dist' ? '−' : '+'}{formatGNF(m.amount)}
                    </Text>
                    {/* The original USD figure stays visible on its own row,
                        not folded into the GNF total — this is the actual
                        record of what was sent, the GNF number is the
                        converted value derived from it, not the other way
                        around. */}
                    {m.kind === 'entry' && (m.ref as InvestmentEntry)?.currency === 'USD' && (
                      <Text style={styles.movementNote}>
                        ${formatNumber((m.ref as InvestmentEntry).originalAmount ?? 0)} USD
                      </Text>
                    )}
                    {!!m.note && <Text style={styles.movementNote}>{m.note}</Text>}
                  </View>
                  <Text style={styles.movementDate}>{formatDate(m.date)}</Text>
                  {canTap && <Ionicons name="ellipsis-horizontal" size={16} color={palette.muted} style={{ marginLeft: 8 }} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {canManage && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Button label="Ajouter un apport" fullWidth size="lg" onPress={openAddEntry} />
          <TouchableOpacity onPress={() => { setDistForm(EMPTY_ENTRY); setShowDistModal(true); }} style={styles.withdrawLink}>
            <Text style={styles.withdrawLinkText}>Retirer des fonds</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Overflow menu: Modifier / Supprimer */}
      <AppModal visible={menuVisible} onClose={() => setMenuVisible(false)} showCloseButton={false}>
        <TouchableOpacity style={styles.menuRow} onPress={() => switchModal(() => setMenuVisible(false), openEdit)}>
          <Ionicons name="pencil-outline" size={18} color={palette.ink} />
          <Text style={styles.menuRowText}>Modifier</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => switchModal(() => setMenuVisible(false), () => setDeleteInvestorConfirm(true))}>
          <Ionicons name="trash-outline" size={18} color={palette.critical} />
          <Text style={[styles.menuRowText, { color: palette.critical }]}>Supprimer</Text>
        </TouchableOpacity>
      </AppModal>

      {/* Edit investor */}
      <AppModal visible={editModal} onClose={() => setEditModal(false)} title="Modifier investisseur">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom *</Text>
          <TextInput style={styles.input} value={editForm.name} onChangeText={(v) => setEditForm((f) => ({ ...f, name: v }))} />
          <Text style={styles.fieldLabel}>Part fixée (%, optionnel)</Text>
          <TextInput style={styles.input} keyboardType="decimal-pad" value={editForm.share} onChangeText={(v) => setEditForm((f) => ({ ...f, share: v }))} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} multiline value={editForm.notes} onChangeText={(v) => setEditForm((f) => ({ ...f, notes: v }))} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setEditModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSaveEdit} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Delete investor */}
      <ConfirmDialog
        visible={deleteInvestorConfirm}
        onClose={() => setDeleteInvestorConfirm(false)}
        onConfirm={confirmDeleteInvestor}
        title={`Supprimer "${investor.name}" ?`}
        message="Tous ses apports seront aussi supprimés."
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Add / edit entry (apport) */}
      <AppModal visible={showEntryModal} onClose={() => setShowEntryModal(false)} title={editingEntry ? "Modifier l'apport" : 'Ajouter un apport'}>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {editingEntry && (
            <View style={styles.editWindowBanner}>
              <Ionicons name="time-outline" size={14} color={palette.caution} />
              <Text style={styles.editWindowText}>
                {editRemaining === MAX_EDITS
                  ? `${MAX_EDITS} modifications autorisées par période de 24h`
                  : `${editRemaining} modification${editRemaining > 1 ? 's' : ''} restante${editRemaining > 1 ? 's' : ''} dans les 24h`}
              </Text>
            </View>
          )}
          {/* Currency only on a genuinely new entry — see EntryForm's own
              comment for why editing stays GNF-only. A US-based investor
              sending USD shouldn't have to convert by hand first; someone
              sending GNF directly should never see a currency picker get
              in the way of the common case. */}
          {!editingEntry && (
            <>
              <Text style={styles.fieldLabel}>Devise</Text>
              <View style={styles.currencyRow}>
                {(['GNF', 'USD'] as const).map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.currencyBtn, entryForm.currency === c && styles.currencyBtnActive]}
                    onPress={() => setEntryForm((f) => ({ ...f, currency: c }))}
                  >
                    <Text style={[styles.currencyBtnText, entryForm.currency === c && styles.currencyBtnTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <Text style={styles.fieldLabel}>Montant ({entryForm.currency}) *</Text>
          <MoneyInput style={styles.input} value={entryForm.amount} onChangeText={(v) => setEntryForm((f) => ({ ...f, amount: v }))} autoFocus />
          {!editingEntry && entryForm.currency === 'USD' && (
            // Shown before saving on purpose — the conversion should be
            // visible and checkable, never a silent black-box calculation
            // for a real money entry.
            <Text style={styles.conversionHint}>
              {entryRateLoading
                ? 'Calcul du taux de change…'
                : entryRate
                ? `≈ ${formatGNF(Math.round((parseFloat(entryForm.amount) || 0) * entryRate.rate))} · 1 USD = ${formatNumber(Math.round(entryRate.rate))} GNF (taux du ${formatDate(entryRate.dateUsed)})`
                : 'Taux de change indisponible pour le moment'}
            </Text>
          )}
          <DatePickerField label="Date" value={entryForm.date} onChange={(v) => setEntryForm((f) => ({ ...f, date: v }))} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} multiline value={entryForm.notes} onChangeText={(v) => setEntryForm((f) => ({ ...f, notes: v }))} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowEntryModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSaveEntry} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Withdrawal */}
      <AppModal visible={showDistModal} onClose={() => setShowDistModal(false)} title="Retirer des fonds">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>Argent versé à cet investisseur (part de profit, remboursement...)</Text>
          <Text style={styles.fieldLabel}>Montant (GNF) *</Text>
          <MoneyInput style={styles.input} value={distForm.amount} onChangeText={(v) => setDistForm((f) => ({ ...f, amount: v }))} autoFocus />
          <DatePickerField label="Date" value={distForm.date} onChange={(v) => setDistForm((f) => ({ ...f, date: v }))} />
          <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
          <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} multiline value={distForm.notes} onChangeText={(v) => setDistForm((f) => ({ ...f, notes: v }))} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowDistModal(false)} style={{ flex: 1 }} />
            <Button label="Confirmer" variant="danger" onPress={handleSaveDistribution} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Movement overflow menu */}
      <AppModal visible={!!entryActionsTarget} onClose={() => setEntryActionsTarget(null)} showCloseButton={false}>
        {entryActionsTarget?.kind === 'entry' && (
          <>
            <TouchableOpacity style={styles.menuRow} onPress={() => { const e = entryActionsTarget.item; switchModal(() => setEntryActionsTarget(null), () => openHistory(e)); }}>
              <Ionicons name="time-outline" size={18} color={palette.ink} />
              <Text style={styles.menuRowText}>Historique</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { const e = entryActionsTarget.item; switchModal(() => setEntryActionsTarget(null), () => openEditEntry(e)); }}>
              <Ionicons name="pencil-outline" size={18} color={palette.ink} />
              <Text style={styles.menuRowText}>Modifier</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() => {
            if (!entryActionsTarget) return;
            const target = entryActionsTarget;
            switchModal(
              () => setEntryActionsTarget(null),
              () => {
                if (target.kind === 'entry') setDeleteEntryTarget(target.item);
                else setDeleteDistTarget(target.item);
              }
            );
          }}
        >
          <Ionicons name="trash-outline" size={18} color={palette.critical} />
          <Text style={[styles.menuRowText, { color: palette.critical }]}>Supprimer</Text>
        </TouchableOpacity>
      </AppModal>

      {/* Delete entry / distribution confirms */}
      <ConfirmDialog
        visible={!!deleteEntryTarget}
        onClose={() => setDeleteEntryTarget(null)}
        onConfirm={confirmDeleteEntry}
        title="Supprimer cet apport ?"
        message={deleteEntryTarget ? formatGNF(deleteEntryTarget.amount) : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />
      <ConfirmDialog
        visible={!!deleteDistTarget}
        onClose={() => setDeleteDistTarget(null)}
        onConfirm={confirmDeleteDistribution}
        title="Supprimer ce retrait ?"
        message={deleteDistTarget ? formatGNF(deleteDistTarget.amount) : ''}
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Edit history — written automatically by a DB trigger on every edit
          (db/update15.sql); nobody, including admin, can add to or remove
          from this list except by actually editing the entry. */}
      <AppModal visible={!!historyTarget} onClose={() => setHistoryTarget(null)} title="Historique des modifications">
        <ScrollView style={{ maxHeight: 420 }}>
          {historyLoading && <Text style={styles.empty}>Chargement…</Text>}
          {!historyLoading && historyItems.length === 0 && (
            <Text style={styles.empty}>Jamais modifié depuis sa création.</Text>
          )}
          {!historyLoading && historyItems.map((h, i) => (
            <View key={h.id} style={[styles.movementRow, i < historyItems.length - 1 && styles.rowDivider, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={styles.editWindowText}>{formatDate(h.editedAt.split('T')[0])}</Text>
              {h.before.amount !== h.after.amount && (
                <Text style={styles.movementNote}>Montant : {formatGNF(h.before.amount ?? 0)} → {formatGNF(h.after.amount ?? 0)}</Text>
              )}
              {h.before.date !== h.after.date && (
                <Text style={styles.movementNote}>Date : {h.before.date} → {h.after.date}</Text>
              )}
              {h.before.notes !== h.after.notes && (
                <Text style={styles.movementNote}>Notes : "{h.before.notes || '—'}" → "{h.after.notes || '—'}"</Text>
              )}
            </View>
          ))}
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { paddingBottom: 120, paddingHorizontal: 20 },
  hero: { alignItems: 'center', paddingTop: 32, paddingBottom: 24 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '700', color: palette.moss },
  name: { fontSize: 22, fontWeight: '700', color: palette.ink, marginTop: 12, textAlign: 'center' },
  heroStats: { flexDirection: 'row', gap: 32, marginTop: 20 },
  heroStat: { alignItems: 'center' },
  heroStatLabel: { fontSize: 12, color: palette.muted },
  heroStatValue: { fontSize: 20, fontWeight: '700', color: palette.ink, marginTop: 4 },
  caption: { fontSize: 13, color: palette.muted, marginTop: 8, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 8, fontSize: 14, lineHeight: 22 },
  movementsList: {
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  movementRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  movementAmount: { fontSize: 15, fontWeight: '600', color: palette.ink },
  movementNote: { fontSize: 12, color: palette.muted, marginTop: 2 },
  movementDate: { fontSize: 12, color: palette.muted },
  footer: {
    padding: 16, backgroundColor: palette.paper,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, gap: 10,
  },
  withdrawLink: { alignItems: 'center', paddingVertical: 4 },
  withdrawLinkText: { fontSize: 13, color: palette.muted, fontWeight: '600' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuRowText: { fontSize: 16, color: palette.ink, fontWeight: '500' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  hint: { fontSize: 13, color: palette.muted },
  input: { backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1, borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink },
  currencyRow: { flexDirection: 'row', gap: 8 },
  currencyBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper,
  },
  // mossSoft/mossDeep, not a solid moss fill with white text — that
  // pairing measures ~2.5:1 (light) / ~1.9:1 (dark) contrast, both failing
  // WCAG (see the Coach "Bilan du jour" chip fix elsewhere this session).
  // Not repeating that bug in a brand-new element.
  currencyBtnActive: { backgroundColor: palette.mossSoft, borderColor: palette.moss, borderWidth: 2 },
  currencyBtnText: { fontSize: 14, fontWeight: '600', color: palette.ink },
  currencyBtnTextActive: { color: palette.mossDeep },
  conversionHint: { fontSize: 12, color: palette.muted, marginTop: 6, lineHeight: 17 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  editWindowBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.cautionSoft, borderRadius: 8, padding: 10, marginBottom: 8 },
  editWindowText: { fontSize: 12, color: palette.caution },
});
