import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { getInvestors, addInvestor, updateInvestor, deleteInvestor, syncInvestorsFromSupabase } from '../../store/investors';
import {
  getInvestmentEntries, addInvestmentEntry, updateInvestmentEntry, deleteInvestmentEntry,
  syncInvestmentEntriesFromSupabase,
} from '../../store/investmentEntries';
import { Investor, InvestmentEntry } from '../../types';
import { formatGNF, formatDate } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import DatePickerField from '../../components/DatePickerField';

const C = {
  primary: '#1D9E75',
  red: '#E24B4A',
  purple: '#8E44AD',
  orange: '#EF9F27',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
};

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
  const insets = useSafeAreaInsets();
  const { membership, user } = useAuth();
  const isAdmin = membership?.role === 'admin';
  const isInvestor = membership?.role === 'investor';

  const [investors, setInvestorsState] = useState<Investor[]>([]);
  const [entries, setEntriesState] = useState<InvestmentEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showInvestorModal, setShowInvestorModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<Investor | null>(null);
  const [investorForm, setInvestorForm] = useState<InvestorForm>(EMPTY_INVESTOR);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<InvestmentEntry | null>(null);
  const [entryInvestorId, setEntryInvestorId] = useState<string>('');
  const [entryForm, setEntryForm] = useState<EntryForm>(EMPTY_ENTRY);

  // ── Delete confirm modals ──────────────────────────────────────
  const [deleteInvestorTarget, setDeleteInvestorTarget] = useState<Investor | null>(null);
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<InvestmentEntry | null>(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editRemaining, setEditRemaining] = useState(MAX_EDITS);

  function showToast(message: string, isError: boolean) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }

  const load = useCallback(async () => {
    syncInvestorsFromSupabase();
    syncInvestmentEntriesFromSupabase();
    const [inv, ent] = await Promise.all([getInvestors(), getInvestmentEntries()]);
    setInvestorsState(inv);
    setEntriesState(ent);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visibleInvestors = isInvestor
    ? investors.filter(inv => inv.userId === user?.id)
    : investors;

  const totalForInvestor = (investor: Investor): number => {
    const entriesSum = entries
      .filter((e) => e.investorId === investor.id)
      .reduce((sum, e) => sum + e.amount, 0);
    return investor.amountInvested + entriesSum;
  };

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
      showToast(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`, true);
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
          showToast(`Limite atteinte. Vous pourrez modifier à nouveau dans ${hoursUntilReset}h`, true);
        } else {
          showToast(`Il vous reste ${remaining} modification${remaining > 1 ? 's' : ''} dans les 24h`, false);
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

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  if (isInvestor && visibleInvestors.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Mon investissement</Text>
        </View>
        <View style={styles.emptyWrap}>
          <Ionicons name="information-circle-outline" size={48} color={C.muted} />
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{isInvestor ? 'Mon investissement' : 'Investisseurs'}</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.addBtn} onPress={openAddInvestor}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {isInvestor && (
        <View style={styles.readOnlyBanner}>
          <Ionicons name="eye-outline" size={14} color={C.muted} />
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
              <Text style={[styles.summaryValue, { color: C.primary }]}>{(100 - totalShares).toFixed(1)}%</Text>
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
            <Ionicons name="trending-up-outline" size={48} color={C.muted} />
            <Text style={styles.emptyText}>Aucun investisseur</Text>
            {isAdmin && <Text style={styles.emptyHint}>Appuyez sur + pour ajouter un investisseur</Text>}
          </View>
        }
        renderItem={({ item }) => {
          const total = totalForInvestor(item);
          const investorEntries = entries.filter((e) => e.investorId === item.id).sort((a, b) => b.date.localeCompare(a.date));
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
                      <Ionicons name="pencil-outline" size={18} color={C.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setDeleteInvestorTarget(item)}>
                      <Ionicons name="trash-outline" size={18} color={C.red} />
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
                  <Text style={styles.statLabel}>Part contractuelle</Text>
                  <Text style={[styles.statValue, { color: C.purple }]}>{item.sharePercentage}%</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Part du capital</Text>
                  <Text style={[styles.statValue, { color: C.orange }]}>{capitalShare.toFixed(1)}%</Text>
                </View>
              </View>

              <View style={styles.historyRow}>
                <TouchableOpacity style={styles.historyToggle} onPress={() => toggleExpand(item.id)}>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
                  <Text style={styles.historyToggleText}>
                    Historique ({item.amountInvested > 0 ? investorEntries.length + 1 : investorEntries.length} versements)
                  </Text>
                </TouchableOpacity>
                {isAdmin && (
                  <TouchableOpacity style={styles.addEntryBtn} onPress={() => openAddEntry(item.id)}>
                    <Ionicons name="add" size={16} color={C.primary} />
                    <Text style={styles.addEntryText}>Versement</Text>
                  </TouchableOpacity>
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
                  {investorEntries.length === 0 && item.amountInvested === 0 && (
                    <Text style={styles.noEntries}>Aucun versement enregistré</Text>
                  )}
                  {investorEntries.map((entry) => (
                    <View key={entry.id} style={styles.entryRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryAmount}>{formatGNF(entry.amount)}</Text>
                        {!!entry.notes && <Text style={styles.entryNote}>{entry.notes}</Text>}
                      </View>
                      <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
                      {isAdmin && (
                        <View style={{ flexDirection: 'row', gap: 2 }}>
                          <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => openEditEntry(entry)}>
                            <Ionicons name="pencil-outline" size={16} color={C.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.deleteEntryBtn} onPress={() => setDeleteEntryTarget(entry)}>
                            <Ionicons name="close-circle-outline" size={18} color={C.red} />
                          </TouchableOpacity>
                        </View>
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
      <Modal visible={showInvestorModal} animationType="slide" transparent onRequestClose={() => setShowInvestorModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editingInvestor ? 'Modifier investisseur' : 'Nouvel investisseur'}</Text>
              <ScrollView>
                <Text style={styles.fieldLabel}>Nom *</Text>
                <TextInput style={styles.input} placeholder="Nom de l'investisseur" value={investorForm.name} onChangeText={(v) => setInvestorForm((f) => ({ ...f, name: v }))} autoFocus />
                {!editingInvestor && (
                  <>
                    <Text style={styles.fieldLabel}>Investissement initial (GNF)</Text>
                    <TextInput style={styles.input} placeholder="Ex: 50 000 000" keyboardType="numeric" value={investorForm.initialAmount} onChangeText={(v) => setInvestorForm((f) => ({ ...f, initialAmount: v }))} />
                  </>
                )}
                <Text style={styles.fieldLabel}>Part / Actions (%)</Text>
                <TextInput style={styles.input} placeholder="Ex: 30" keyboardType="decimal-pad" value={investorForm.share} onChangeText={(v) => setInvestorForm((f) => ({ ...f, share: v }))} />
                <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
                <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Notes sur cet investisseur…" multiline value={investorForm.notes} onChangeText={(v) => setInvestorForm((f) => ({ ...f, notes: v }))} />
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowInvestorModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, saving && { opacity: 0.6 }]} onPress={handleSaveInvestor} disabled={saving}>
                  <Text style={styles.confirmText}>{saving ? '…' : 'Enregistrer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Investment entry modal */}
      <Modal visible={showEntryModal} animationType="slide" transparent onRequestClose={() => setShowEntryModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editingEntry ? 'Modifier le versement' : 'Ajouter un versement'}</Text>
              {editingEntry && (
                <View style={styles.editWindowBanner}>
                  <Ionicons name="time-outline" size={14} color={C.orange} />
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
              <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} placeholder="Ex: Deuxième versement, tranche 2…" multiline value={entryForm.notes} onChangeText={(v) => setEntryForm((f) => ({ ...f, notes: v }))} />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowEntryModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, saving && { opacity: 0.6 }]} onPress={handleSaveEntry} disabled={saving}>
                  <Text style={styles.confirmText}>{saving ? '…' : 'Enregistrer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete investor confirm */}
      <Modal visible={!!deleteInvestorTarget} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer "{deleteInvestorTarget?.name}" ?</Text>
            <Text style={styles.confirmSub}>Tous ses versements seront aussi supprimés.</Text>
            <TouchableOpacity style={styles.confirmBtnRed} onPress={confirmDeleteInvestor}>
              <Text style={styles.confirmBtnText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteInvestorTarget(null)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete entry confirm */}
      <Modal visible={!!deleteEntryTarget} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="trash-outline" size={32} color={C.red} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Supprimer ce versement ?</Text>
            <Text style={styles.confirmSub}>{deleteEntryTarget ? formatGNF(deleteEntryTarget.amount) : ''}</Text>
            <TouchableOpacity style={styles.confirmBtnRed} onPress={confirmDeleteEntry}>
              <Text style={styles.confirmBtnText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteEntryTarget(null)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit rate-limit toast */}
      {toast && (
        <View style={[styles.toast, toast.isError ? styles.toastError : styles.toastSuccess]} pointerEvents="none">
          <Ionicons
            name={toast.isError ? 'warning-outline' : 'checkmark-circle-outline'}
            size={18}
            color="#FFF"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0F0EE', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border },
  readOnlyText: { fontSize: 12, color: C.muted },
  summaryCard: { backgroundColor: C.card, margin: 16, borderRadius: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 11, color: C.muted, marginBottom: 4, textAlign: 'center' },
  summaryValue: { fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' },
  divider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 40, gap: 8, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.muted },
  emptyHint: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F0E8F8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: C.purple },
  investorName: { fontSize: 16, fontWeight: '600', color: C.text },
  investorNotes: { fontSize: 13, color: C.muted, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardStats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 10, color: C.muted, marginBottom: 3, textAlign: 'center' },
  statValue: { fontSize: 13, fontWeight: '700', color: C.text, textAlign: 'center' },
  historyRow: { flexDirection: 'row', alignItems: 'center' },
  historyToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyToggleText: { fontSize: 13, color: C.muted },
  addEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E8F6F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addEntryText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  entriesList: { borderTopWidth: 1, borderColor: C.border, paddingTop: 10, gap: 8 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 8, padding: 10 },
  entryAmount: { fontSize: 14, fontWeight: '600', color: C.text },
  entryNote: { fontSize: 12, color: C.muted, marginTop: 2 },
  editableHint: { fontSize: 11, color: C.orange, marginTop: 2 },
  entryDate: { fontSize: 12, color: C.muted },
  deleteEntryBtn: { padding: 2 },
  noEntries: { fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 8 },
  editWindowBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF4E4', borderRadius: 8, padding: 10, marginBottom: 8 },
  editWindowText: { fontSize: 12, color: C.orange },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, maxHeight: '90%' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, fontSize: 16, color: C.text },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, color: C.muted, fontWeight: '600' },
  confirmBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 16, color: '#FFFFFF', fontWeight: '700' },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: C.card, borderRadius: 20, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  confirmSub: { fontSize: 14, color: C.muted, textAlign: 'center', marginBottom: 4, lineHeight: 20 },
  confirmBtnRed: { marginTop: 16, backgroundColor: C.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  toast: {
    position: 'absolute', bottom: 24, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, zIndex: 9999,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, elevation: 8,
  },
  toastSuccess: { backgroundColor: C.primary },
  toastError: { backgroundColor: C.red },
  toastText: { flex: 1, color: '#FFF', fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
