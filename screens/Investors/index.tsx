import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { getInvestors, addInvestor, updateInvestor, deleteInvestor, syncInvestorsFromSupabase } from '../../store/investors';
import {
  getInvestmentEntries, addInvestmentEntry, updateInvestmentEntry, deleteInvestmentEntry,
  syncInvestmentEntriesFromSupabase, getEntryEditHistory,
} from '../../store/investmentEntries';
import {
  getDistributions, addDistribution, deleteDistribution,
  syncDistributionsFromSupabase,
} from '../../store/investorDistributions';
import { Investor, InvestmentEntry, InvestorDistribution, EditHistoryEntry } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import DatePickerField from '../../components/DatePickerField';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, toast } from '../../components/ui';

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

type InvestorForm = { name: string; share: string; notes: string; initialAmount: string };
const EMPTY_INVESTOR: InvestorForm = { name: '', share: '', notes: '', initialAmount: '' };

type EntryForm = { amount: string; date: string; notes: string };
const EMPTY_ENTRY: EntryForm = { amount: '', date: toDateString(), notes: '' };

export default function InvestorsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation();
  const { membership, user } = useAuth();
  const isAdmin = membership?.role === 'admin';
  const isInvestor = membership?.role === 'investor';

  // Title (role-dependent) and the "+" action both live in the native
  // header (this screen has one — see the rule in navigation/index.tsx),
  // not duplicated as a second row below it.
  useLayoutEffect(() => {
    navigation.setOptions({
      title: isInvestor ? 'Mon investissement' : 'Investisseurs',
      headerRight: () => isAdmin ? (
        <TouchableOpacity onPress={openAddInvestor} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ) : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isInvestor, isAdmin, palette.moss]);

  const [investors, setInvestorsState] = useState<Investor[]>([]);
  const [entries, setEntriesState] = useState<InvestmentEntry[]>([]);
  const [distributions, setDistributionsState] = useState<InvestorDistribution[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showInvestorModal, setShowInvestorModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<Investor | null>(null);
  const [investorForm, setInvestorForm] = useState<InvestorForm>(EMPTY_INVESTOR);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<InvestmentEntry | null>(null);
  const [entryInvestorId, setEntryInvestorId] = useState<string>('');
  const [entryForm, setEntryForm] = useState<EntryForm>(EMPTY_ENTRY);

  const [showDistModal, setShowDistModal] = useState(false);
  const [distInvestorId, setDistInvestorId] = useState<string>('');
  const [distForm, setDistForm] = useState<EntryForm>(EMPTY_ENTRY);

  // ── Delete confirm modals ──────────────────────────────────────
  const [deleteInvestorTarget, setDeleteInvestorTarget] = useState<Investor | null>(null);
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<InvestmentEntry | null>(null);
  const [deleteDistTarget, setDeleteDistTarget] = useState<InvestorDistribution | null>(null);

  // ── Edit history (append-only, written by a DB trigger — see
  // db/update15.sql) ─────────────────────────────────────────────
  const [historyTarget, setHistoryTarget] = useState<InvestmentEntry | null>(null);
  const [historyItems, setHistoryItems] = useState<EditHistoryEntry<Partial<InvestmentEntry>>[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openHistory = async (entry: InvestmentEntry) => {
    setHistoryTarget(entry);
    setHistoryLoading(true);
    const items = await getEntryEditHistory(entry.id);
    setHistoryItems(items);
    setHistoryLoading(false);
  };

  const [saving, setSaving] = useState(false);
  const [editRemaining, setEditRemaining] = useState(MAX_EDITS);

  const load = useCallback(async () => {
    const [inv, ent, dist] = await Promise.all([getInvestors(), getInvestmentEntries(), getDistributions()]);
    setInvestorsState(inv);
    setEntriesState(ent);
    setDistributionsState(dist);
    await Promise.all([syncInvestorsFromSupabase(), syncInvestmentEntriesFromSupabase(), syncDistributionsFromSupabase()]);
    const [freshInv, freshEnt, freshDist] = await Promise.all([getInvestors(), getInvestmentEntries(), getDistributions()]);
    setInvestorsState(freshInv);
    setEntriesState(freshEnt);
    setDistributionsState(freshDist);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visibleInvestors = isInvestor
    ? investors.filter(inv => inv.userId === user?.id)
    : investors;

  const totalForInvestor = (investor: Investor): number => {
    const entriesSum = entries
      .filter((e) => e.investorId === investor.id)
      .reduce((sum, e) => sum + e.amount, 0);
    const distSum = distributions
      .filter((d) => d.investorId === investor.id)
      .reduce((sum, d) => sum + d.amount, 0);
    return investor.amountInvested + entriesSum - distSum;
  };

  const totalDistributedFor = (investorId: string): number =>
    distributions.filter((d) => d.investorId === investorId).reduce((sum, d) => sum + d.amount, 0);

  const grandTotal = investors.reduce((sum, inv) => sum + totalForInvestor(inv), 0);
  const totalShares = investors.reduce((sum, inv) => sum + inv.sharePercentage, 0);

  const openAddInvestor = () => {
    setEditingInvestor(null);
    setInvestorForm(EMPTY_INVESTOR);
    setShowInvestorModal(true);
  };

  const openEditInvestor = (investor: Investor) => {
    setEditingInvestor(investor);
    setInvestorForm({ name: investor.name, share: String(investor.sharePercentage), notes: investor.notes ?? '', initialAmount: '' });
    setShowInvestorModal(true);
  };

  const handleSaveInvestor = async () => {
    if (!investorForm.name.trim()) return;
    setSaving(true);
    try {
      const share = parseFloat(investorForm.share) || 0;
      if (editingInvestor) {
        await updateInvestor(editingInvestor.id, { name: investorForm.name.trim(), sharePercentage: share, notes: investorForm.notes.trim() });
      } else {
        const initialAmount = parseFloat(investorForm.initialAmount) || 0;
        const newInv = await addInvestor({ name: investorForm.name.trim(), amountInvested: initialAmount, sharePercentage: share, notes: investorForm.notes.trim() });
        if (initialAmount > 0) {
          await addInvestmentEntry({ investorId: newInv.id, amount: initialAmount, date: toDateString(), notes: 'Investissement initial' });
          await updateInvestor(newInv.id, { amountInvested: 0 });
        }
      }
      await load();
      setShowInvestorModal(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteInvestor = async () => {
    if (!deleteInvestorTarget) return;
    await deleteInvestor(deleteInvestorTarget.id);
    const toDelete = entries.filter((e) => e.investorId === deleteInvestorTarget.id);
    await Promise.all(toDelete.map((e) => deleteInvestmentEntry(e.id)));
    setDeleteInvestorTarget(null);
    await load();
  };

  const openAddEntry = (investorId: string) => {
    setEditingEntry(null);
    setEntryInvestorId(investorId);
    setEntryForm(EMPTY_ENTRY);
    setShowEntryModal(true);
  };

  const openEditEntry = async (entry: InvestmentEntry) => {
    const { allowed, remaining, hoursUntilReset } = await checkEditAllowed(entry.id);
    if (!allowed) {
      toast.warning(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`);
      return;
    }
    setEditRemaining(remaining);
    setEditingEntry(entry);
    setEntryInvestorId(entry.investorId);
    setEntryForm({ amount: String(entry.amount), date: entry.date, notes: entry.notes ?? '' });
    setShowEntryModal(true);
  };

  const handleSaveEntry = async () => {
    const amount = parseFloat(entryForm.amount) || 0;
    if (amount <= 0) return;
    setSaving(true);
    try {
      if (editingEntry) {
        await updateInvestmentEntry(editingEntry.id, { amount, date: entryForm.date, notes: entryForm.notes.trim() || undefined });
        const remaining = await recordEdit(editingEntry.id);
        await load();
        setShowEntryModal(false);
        if (remaining === 0) {
          const { hoursUntilReset } = await checkEditAllowed(editingEntry.id);
          toast.warning(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`);
        } else {
          toast.success(`Il vous reste ${remaining} modification${remaining > 1 ? 's' : ''} dans les 24h`);
        }
      } else {
        await addInvestmentEntry({ investorId: entryInvestorId, amount, date: entryForm.date, notes: entryForm.notes.trim() || undefined });
        await load();
        setShowEntryModal(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteEntry = async () => {
    if (!deleteEntryTarget) return;
    await deleteInvestmentEntry(deleteEntryTarget.id);
    setDeleteEntryTarget(null);
    await load();
  };

  const openAddDistribution = (investorId: string) => {
    setDistInvestorId(investorId);
    setDistForm(EMPTY_ENTRY);
    setShowDistModal(true);
  };

  const handleSaveDistribution = async () => {
    const amount = parseFloat(distForm.amount) || 0;
    if (amount <= 0) return;
    setSaving(true);
    try {
      await addDistribution({ investorId: distInvestorId, amount, date: distForm.date, notes: distForm.notes.trim() || undefined });
      await load();
      setShowDistModal(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteDistribution = async () => {
    if (!deleteDistTarget) return;
    await deleteDistribution(deleteDistTarget.id);
    setDeleteDistTarget(null);
    await load();
  };

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  if (isInvestor && visibleInvestors.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyWrap}>
          <Ionicons name="information-circle-outline" size={48} color={palette.muted} />
          <Text style={styles.emptyText}>Profil non lié</Text>
          <Text style={styles.emptyHint}>
            Votre profil d'investisseur n'a pas encore été configuré.{'\n'}
            Contactez l'administrateur pour qu'il lie votre compte à vos données d'investisseur.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isInvestor && (
        <View style={styles.readOnlyBanner}>
          <Ionicons name="eye-outline" size={14} color={palette.muted} />
          <Text style={styles.readOnlyText}>Vue lecture seule — contactez l'administrateur pour modifier</Text>
        </View>
      )}

      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Capital total</Text>
          <Text style={styles.summaryValue}>{formatGNF(grandTotal)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Parts distribuées</Text>
          <Text style={styles.summaryValue}>{totalShares.toFixed(1)}%</Text>
        </View>
        {!isInvestor && totalShares < 100 && (
          <>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Fondateur</Text>
              <Text style={[styles.summaryValue, { color: palette.moss }]}>{(100 - totalShares).toFixed(1)}%</Text>
            </View>
          </>
        )}
      </View>

      <FlatList
        data={visibleInvestors}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="trending-up-outline" size={48} color={palette.muted} />
            <Text style={styles.emptyText}>Aucun investisseur</Text>
            {isAdmin && <Text style={styles.emptyHint}>Appuyez sur + pour ajouter un investisseur</Text>}
          </View>
        }
        renderItem={({ item }) => {
          const total = totalForInvestor(item);
          const investorEntries = entries.filter((e) => e.investorId === item.id).sort((a, b) => b.date.localeCompare(a.date));
          const investorDists = distributions.filter((d) => d.investorId === item.id).sort((a, b) => b.date.localeCompare(a.date));
          const isExpanded = expandedId === item.id;
          const capitalShare = grandTotal > 0 ? (total / grandTotal) * 100 : 0;

          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.avatarWrap}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.investorName}>{item.name}</Text>
                  {!!item.notes && <Text style={styles.investorNotes} numberOfLines={1}>{item.notes}</Text>}
                </View>
                {isAdmin && (
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEditInvestor(item)}>
                      <Ionicons name="pencil-outline" size={18} color={palette.moss} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setDeleteInvestorTarget(item)}>
                      <Ionicons name="trash-outline" size={18} color={palette.critical} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.cardStats}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Total investi</Text>
                  <Text style={styles.statValue}>{formatGNF(total)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Part</Text>
                  <Text style={styles.statValue}>{item.sharePercentage}%</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Part du capital</Text>
                  <Text style={[styles.statValue, { color: palette.moss }]}>{capitalShare.toFixed(1)}%</Text>
                </View>
              </View>

              {totalDistributedFor(item.id) > 0 && (
                <View style={styles.cardStats}>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Total distribué</Text>
                    <Text style={[styles.statValue, { color: palette.critical }]}>{formatGNF(totalDistributedFor(item.id))}</Text>
                  </View>
                </View>
              )}

              <View style={styles.historyRow}>
                <TouchableOpacity style={styles.historyToggle} onPress={() => toggleExpand(item.id)}>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
                  <Text style={styles.historyToggleText}>
                    Historique ({(item.amountInvested > 0 ? investorEntries.length + 1 : investorEntries.length) + investorDists.length} mouvements)
                  </Text>
                </TouchableOpacity>
                {isAdmin && (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={styles.addEntryBtn} onPress={() => openAddEntry(item.id)}>
                      <Ionicons name="add" size={16} color={palette.moss} />
                      <Text style={styles.addEntryText}>Apport</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.addEntryBtn, { backgroundColor: palette.criticalSoft }]} onPress={() => openAddDistribution(item.id)}>
                      <Ionicons name="remove" size={16} color={palette.critical} />
                      <Text style={[styles.addEntryText, { color: palette.critical }]}>Retrait</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {isExpanded && (
                <View style={styles.entriesList}>
                  {item.amountInvested > 0 && (
                    <View style={styles.entryRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryAmount}>{formatGNF(item.amountInvested)}</Text>
                        <Text style={styles.entryNote}>Investissement de base</Text>
                      </View>
                      <Text style={styles.entryDate}>{formatDate(item.dateAdded.split('T')[0])}</Text>
                    </View>
                  )}
                  {investorEntries.length === 0 && investorDists.length === 0 && item.amountInvested === 0 && (
                    <Text style={styles.noEntries}>Aucun apport enregistré</Text>
                  )}
                  {investorEntries.map((entry) => (
                    <View key={entry.id} style={styles.entryRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryAmount}>+{formatGNF(entry.amount)}</Text>
                        {!!entry.notes && <Text style={styles.entryNote}>{entry.notes}</Text>}
                      </View>
                      <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
                      {isAdmin && (
                        <View style={{ flexDirection: 'row', gap: 2 }}>
                          <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => openHistory(entry)}>
                            <Ionicons name="time-outline" size={16} color={palette.muted} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => openEditEntry(entry)}>
                            <Ionicons name="pencil-outline" size={16} color={palette.moss} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => setDeleteEntryTarget(entry)}>
                            <Ionicons name="close-circle-outline" size={18} color={palette.critical} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ))}
                  {investorDists.map((dist) => (
                    <View key={dist.id} style={styles.entryRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.entryAmount, { color: palette.critical }]}>−{formatGNF(dist.amount)}</Text>
                        <Text style={styles.entryNote}>{dist.notes || 'Retrait effectué'}</Text>
                      </View>
                      <Text style={styles.entryDate}>{formatDate(dist.date)}</Text>
                      {isAdmin && (
                        <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => setDeleteDistTarget(dist)}>
                          <Ionicons name="close-circle-outline" size={18} color={palette.critical} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Investor form modal */}
      <AppModal
        visible={showInvestorModal}
        onClose={() => setShowInvestorModal(false)}
        title={editingInvestor ? 'Modifier investisseur' : 'Nouvel investisseur'}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Nom *</Text>
            <TextInput style={styles.input} placeholder="Nom de l'investisseur" value={investorForm.name} onChangeText={(v) => setInvestorForm((f) => ({ ...f, name: v }))} autoFocus />
            {!editingInvestor && (
              <>
                <Text style={styles.fieldLabel}>Premier apport (GNF)</Text>
                <TextInput style={styles.input} placeholder="Ex: 50 000 000" keyboardType="numeric" value={investorForm.initialAmount} onChangeText={(v) => setInvestorForm((f) => ({ ...f, initialAmount: v }))} />
              </>
            )}
            <Text style={styles.fieldLabel}>Part (%)</Text>
            <TextInput style={styles.input} placeholder="Ex: 30" keyboardType="decimal-pad" value={investorForm.share} onChangeText={(v) => setInvestorForm((f) => ({ ...f, share: v }))} />
            <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Notes sur cet investisseur…" multiline value={investorForm.notes} onChangeText={(v) => setInvestorForm((f) => ({ ...f, notes: v }))} />
          </ScrollView>
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowInvestorModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSaveInvestor} loading={saving} style={{ flex: 1 }} />
          </View>
        </KeyboardAvoidingView>
      </AppModal>

      {/* Investment entry modal */}
      <AppModal
        visible={showEntryModal}
        onClose={() => setShowEntryModal(false)}
        title={editingEntry ? "Modifier l'apport" : 'Ajouter un apport'}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled">
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
            <Text style={styles.fieldLabel}>Montant (GNF) *</Text>
            <TextInput style={styles.input} placeholder="Ex: 10 000 000" keyboardType="numeric" value={entryForm.amount} onChangeText={(v) => setEntryForm((f) => ({ ...f, amount: v }))} autoFocus />
            <DatePickerField label="Date" value={entryForm.date} onChange={(v) => setEntryForm((f) => ({ ...f, date: v }))} />
            <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} placeholder="Ex: Deuxième apport, tranche 2…" multiline value={entryForm.notes} onChangeText={(v) => setEntryForm((f) => ({ ...f, notes: v }))} />
          </ScrollView>
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowEntryModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={handleSaveEntry} loading={saving} style={{ flex: 1 }} />
          </View>
        </KeyboardAvoidingView>
      </AppModal>

      {/* Withdrawal (payout) modal */}
      <AppModal visible={showDistModal} onClose={() => setShowDistModal(false)} title="Nouveau retrait">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { marginTop: 0, color: palette.muted, fontWeight: '400' }]}>
              Argent versé à cet investisseur (part de profit, remboursement...)
            </Text>
            <Text style={styles.fieldLabel}>Montant (GNF) *</Text>
            <TextInput style={styles.input} placeholder="Ex: 5 000 000" keyboardType="numeric" value={distForm.amount} onChangeText={(v) => setDistForm((f) => ({ ...f, amount: v }))} autoFocus />
            <DatePickerField label="Date" value={distForm.date} onChange={(v) => setDistForm((f) => ({ ...f, date: v }))} />
            <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} placeholder="Ex: Part de profit T1…" multiline value={distForm.notes} onChangeText={(v) => setDistForm((f) => ({ ...f, notes: v }))} />
          </ScrollView>
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowDistModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" variant="danger" onPress={handleSaveDistribution} loading={saving} style={{ flex: 1 }} />
          </View>
        </KeyboardAvoidingView>
      </AppModal>

      {/* Delete distribution confirm */}
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

      {/* Delete investor confirm */}
      <ConfirmDialog
        visible={!!deleteInvestorTarget}
        onClose={() => setDeleteInvestorTarget(null)}
        onConfirm={confirmDeleteInvestor}
        title={`Supprimer "${deleteInvestorTarget?.name}" ?`}
        message="Tous ses apports seront aussi supprimés."
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* Delete entry confirm */}
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

      {/* Edit history — written automatically by a DB trigger on every
          edit (db/update15.sql); nobody, including admin, can add to or
          remove from this list except by actually editing the entry. */}
      <AppModal visible={!!historyTarget} onClose={() => setHistoryTarget(null)} title="Historique des modifications">
        <ScrollView style={{ maxHeight: 420 }}>
          {historyLoading && <Text style={styles.noEntries}>Chargement…</Text>}
          {!historyLoading && historyItems.length === 0 && (
            <Text style={styles.noEntries}>Jamais modifié depuis sa création.</Text>
          )}
          {!historyLoading && historyItems.map((h) => (
            <View key={h.id} style={[styles.entriesList, { paddingTop: 10, marginBottom: 10 }]}>
              <Text style={styles.editWindowText}>{formatDate(h.editedAt.split('T')[0])}</Text>
              {h.before.amount !== h.after.amount && (
                <Text style={styles.entryNote}>Montant : {formatGNF(h.before.amount ?? 0)} → {formatGNF(h.after.amount ?? 0)}</Text>
              )}
              {h.before.date !== h.after.date && (
                <Text style={styles.entryNote}>Date : {h.before.date} → {h.after.date}</Text>
              )}
              {h.before.notes !== h.after.notes && (
                <Text style={styles.entryNote}>Notes : "{h.before.notes || '—'}" → "{h.after.notes || '—'}"</Text>
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
  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.line, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.line },
  readOnlyText: { fontSize: 12, color: palette.muted },
  summaryCard: { backgroundColor: palette.card, margin: 16, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 11, color: palette.muted, marginBottom: 4, textAlign: 'center' },
  summaryValue: { fontSize: 15, fontWeight: '700', color: palette.ink, textAlign: 'center' },
  divider: { width: 1, backgroundColor: palette.line, marginHorizontal: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 40, gap: 8, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: palette.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: palette.line, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: palette.moss },
  investorName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  investorNotes: { fontSize: 13, color: palette.muted, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardStats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: palette.paper, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 10, color: palette.muted, marginBottom: 3, textAlign: 'center' },
  statValue: { fontSize: 13, fontWeight: '700', color: palette.ink, textAlign: 'center' },
  historyRow: { flexDirection: 'row', alignItems: 'center' },
  historyToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyToggleText: { fontSize: 13, color: palette.muted },
  addEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.mossSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addEntryText: { fontSize: 13, color: palette.moss, fontWeight: '600' },
  entriesList: { borderTopWidth: 1, borderColor: palette.line, paddingTop: 10, gap: 8 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.paper, borderRadius: 8, padding: 10 },
  entryAmount: { fontSize: 14, fontWeight: '600', color: palette.ink },
  entryNote: { fontSize: 12, color: palette.muted, marginTop: 2 },
  editableHint: { fontSize: 11, color: palette.caution, marginTop: 2 },
  entryDate: { fontSize: 12, color: palette.muted },
  deleteEntryBtn: { padding: 2 },
  noEntries: { fontSize: 13, color: palette.muted, textAlign: 'center', paddingVertical: 8 },
  editWindowBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.cautionSoft, borderRadius: 8, padding: 10, marginBottom: 8 },
  editWindowText: { fontSize: 12, color: palette.caution },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1, borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
