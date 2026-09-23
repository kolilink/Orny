import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, TextInput, SectionList, Image, Platform, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Expense, CustomCategory } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import {
  getExpenses, addExpense, updateExpense, deleteExpense, restoreExpense, purgeDeletedExpense,
  getDeletedExpenses, syncExpensesFromSupabase, getSignedReceiptUrl,
} from '../../store/expenses';
import { getCustomCategories } from '../../store/customCategories';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, MoneyInput, Text } from '../../components/ui';

const BUILT_IN: CustomCategory[] = [
  { key: 'loyer', label: 'Loyer', icon: '🏠' },
  { key: 'salaire', label: 'Salaire', icon: '👷' },
  { key: 'matiere_premiere', label: 'Matières premières', icon: '🥔' },
  { key: 'energie', label: 'Énergie / Gaz', icon: '⚡' },
  { key: 'transport', label: 'Transport', icon: '🚚' },
  { key: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { key: 'autre', label: 'Autre', icon: '📦' },
];

function catInfo(key: string, allCats: CustomCategory[]) {
  return allCats.find((c) => c.key === key) ?? { label: key, icon: '📦' };
}
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthKey(dateStr: string) { return dateStr.slice(0, 7); }
function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}
function parseNum(s: string) { return parseInt(s.replace(/\s/g, ''), 10) || 0; }

type DateMode = 'hier' | 'aujourdhui' | 'autre';

// Web-only: prompts the browser's own file picker, resolves to a base64
// data URL — same helper AddDocument.tsx already uses for the identical
// "no native camera/gallery API on web" gap.
function webPickFromDisk(accept: string, capture?: string): Promise<{ uri: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onloadend = () => resolve({ uri: reader.result as string });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export default function ExpensesScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deletedExpenses, setDeletedExpenses] = useState<Expense[]>([]);
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Month sections collapsed by default, tap to expand — same pattern as
  // Suppliers' MonthGroup.
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Add/edit modal — simplified to its core (2026-09-06): amount,
  // description, date, an optional photo, one Enregistrer button. No
  // category picker, no payment-method toggle, no line-item/receipt
  // itemization, no "save and add another" — matching Patron's own
  // "Nouvelle dépense" form exactly, on direct request. A new expense's
  // category/paymentMethod still exist in the data model (other screens
  // read them) — they're just silently defaulted ('autre'/'cash'), never
  // asked about. Editing an existing expense never touches its own
  // category/paymentMethod (they're simply left out of the update
  // payload), so older categorized expenses keep their real category. ──
  // formView swaps the "Ajouter une image" source picker in as this same
  // modal's own internal view instead of a second <AppModal> stacked on
  // top of it — AppModal always mounts a real native RNModal for as long
  // as its own close animation runs (see its own file), so opening a
  // second one while this one is still visible would risk the exact
  // "two native modals briefly stacked" glitch fixed in Production's
  // actions menu (see CLAUDE.md).
  const [formModal, setFormModal] = useState(false);
  const [formView, setFormView] = useState<'fields' | 'photoSource'>('fields');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('aujourdhui');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Receipt viewer ──────────────────────────────────────────────
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  // ── Delete confirm modal ──────────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);

  const allCats = [...BUILT_IN, ...customCats];

  function resetForm() {
    setEditingId(null);
    setDescription('');
    setAmount('');
    setDateMode('aujourdhui');
    setDate(toDateStr(new Date()));
    setPhotoUri(null);
    setFormView('fields');
  }

  function openAdd() {
    resetForm();
    setFormModal(true);
  }

  // ── Load data ──────────────────────────────────────────────────
  // Cache-first: render instantly from cache, then sync and re-render once
  // fresh data lands.
  const load = useCallback(async () => {
    const [exp, cats, del] = await Promise.all([
      getExpenses(), getCustomCategories(), getDeletedExpenses(),
    ]);
    setExpenses(exp);
    setCustomCats(cats);
    setDeletedExpenses(del);

    await syncExpensesFromSupabase();
    setExpenses(await getExpenses());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Open expense for editing ───────────────────────────────────
  function openEdit(expense: Expense) {
    setEditingId(expense.id);
    setDescription(expense.description);
    setAmount(String(expense.amount));
    setPhotoUri(null); // a freshly-picked photo replaces the old one; leaving this empty keeps the existing one untouched (see handleSave)
    const today = toDateStr(new Date());
    const yesterday = toDateStr(new Date(Date.now() - 86400000));
    if (expense.date === today) setDateMode('aujourdhui');
    else if (expense.date === yesterday) setDateMode('hier');
    else setDateMode('autre');
    setDate(expense.date);
    setFormModal(true);
  }

  function selectDateMode(mode: DateMode) {
    setDateMode(mode);
    if (mode === 'aujourdhui') setDate(toDateStr(new Date()));
    else if (mode === 'hier') setDate(toDateStr(new Date(Date.now() - 86400000)));
  }

  // ── Photo picking ────────────────────────────────────────────────
  async function pickFromLibrary() {
    setFormView('fields');
    if (Platform.OS === 'web') {
      const result = await webPickFromDisk('image/*');
      if (result) setPhotoUri(result.uri);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la galerie.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function pickFromCamera() {
    setFormView('fields');
    if (Platform.OS === 'web') {
      const result = await webPickFromDisk('image/*', 'environment');
      if (result) setPhotoUri(result.uri);
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la caméra.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function openReceipt(item: Expense) {
    if (!item.photoStoragePath) return;
    const url = await getSignedReceiptUrl(item.photoStoragePath);
    if (url) setViewingPhotoUrl(url);
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSave() {
    if (!description.trim()) return;
    const total = parseNum(amount);
    if (total <= 0) return;

    setSaving(true);
    try {
      if (editingId) {
        await updateExpense(editingId, {
          date, description: description.trim(), amount: total,
          ...(photoUri ? { photoUri } : {}),
        });
      } else {
        const item = await addExpense({
          date, category: 'autre', description: description.trim(), amount: total,
          paymentMethod: 'cash', photoUri: photoUri ?? undefined,
        });
        setExpenses((prev) => [item, ...prev]);
      }
      setFormModal(false);
      resetForm();
      await load();
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'enregistrer la dépense. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  // ── Delete (soft) ─────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteConfirmId) return;
    await deleteExpense(deleteConfirmId);
    setExpenses(prev => prev.filter(e => e.id !== deleteConfirmId));
    const del = await getDeletedExpenses();
    setDeletedExpenses(del);
    if (editingId === deleteConfirmId) { setFormModal(false); resetForm(); }
    setDeleteConfirmId(null);
  }

  async function handleRestore(id: string) {
    await restoreExpense(id);
    const [exp, del] = await Promise.all([getExpenses(), getDeletedExpenses()]);
    setExpenses(exp);
    setDeletedExpenses(del);
  }

  async function confirmPurge() {
    if (!purgeConfirmId) return;
    await purgeDeletedExpense(purgeConfirmId);
    const del = await getDeletedExpenses();
    setDeletedExpenses(del);
    setPurgeConfirmId(null);
  }

  // ── Summary pill ───────────────────────────────────────────────
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthTotal = expenses.filter(e => e.date >= monthStart).reduce((s, e) => s + e.amount, 0);

  // ── Group expenses by month ────────────────────────────────────
  const grouped: Record<string, Expense[]> = {};
  for (const e of expenses) {
    const k = monthKey(e.date);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const expenseSections = Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .map(ym => ({
      title: ym,
      total: grouped[ym].reduce((s, e) => s + e.amount, 0),
      data: grouped[ym].sort((a, b) => b.date.localeCompare(a.date)),
    }));

  return (
    <View style={styles.container}>
      {monthTotal > 0 && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryText}>Ce mois : {formatGNF(monthTotal)}</Text>
          </View>
        </View>
      )}

      <SectionList
        style={{ flex: 1 }}
        sections={expenseSections.map(s => ({ ...s, data: expandedMonths.has(s.title) ? s.data : [] }))}
        keyExtractor={e => e.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée</Text>}
        renderSectionHeader={({ section }) => (
          <TouchableOpacity style={styles.sectionHeader} activeOpacity={0.7} onPress={() => toggleMonth(section.title)}>
            <Text style={styles.sectionTitle}>{monthLabel(section.title)}</Text>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionTotal}>{formatGNF(section.total)}</Text>
              <Ionicons name={expandedMonths.has(section.title) ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
            </View>
          </TouchableOpacity>
        )}
        renderItem={({ item }) => {
          const info = catInfo(item.category, allCats);
          const isExpanded = expandedId === item.id;
          return (
            <TouchableOpacity
              style={styles.expenseCard}
              activeOpacity={0.85}
              onPress={() => item.lineItems?.length ? setExpandedId(isExpanded ? null : item.id) : undefined}
            >
              <View style={styles.expenseMain}>
                <Text style={styles.expenseIcon}>{info.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseDesc}>{item.description || info.label}</Text>
                  <Text style={styles.expenseMeta}>
                    {info.label} · {item.date}
                    {item.lineItems?.length ? `  ·  ${item.lineItems.length} articles` : ''}
                  </Text>
                </View>
                <View style={styles.expenseRight}>
                  <Text style={styles.expenseAmount}>{formatGNF(item.amount)}</Text>
                  {!!item.photoStoragePath && (
                    <TouchableOpacity onPress={() => openReceipt(item)} style={{ padding: 4 }}>
                      <Ionicons name="receipt-outline" size={16} color={palette.muted} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => openEdit(item)} style={{ padding: 4 }}>
                    <Ionicons name="pencil-outline" size={16} color={palette.moss} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDeleteConfirmId(item.id)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={16} color={palette.critical} />
                  </TouchableOpacity>
                </View>
              </View>
              {isExpanded && item.lineItems?.map((li, i) => (
                <View key={i} style={styles.lineItemRow}>
                  <Text style={styles.lineItemName}>{li.quantity ? `${li.quantity} × ` : ''}{li.name}</Text>
                  <Text style={styles.lineItemAmt}>{formatGNF(li.amount)}</Text>
                </View>
              ))}
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          deletedExpenses.length > 0 ? (
            <View style={styles.trashSection}>
              <View style={styles.trashHeader}>
                <Ionicons name="trash-outline" size={16} color={palette.muted} />
                <Text style={styles.trashTitle}>Corbeille ({deletedExpenses.length}) — supprimé pendant 30 jours</Text>
              </View>
              {deletedExpenses.map(e => {
                const info = catInfo(e.category, allCats);
                const deletedDate = e.deletedAt ? new Date(e.deletedAt).toLocaleDateString('fr-FR') : '';
                return (
                  <View key={e.id} style={styles.trashCard}>
                    <Text style={styles.trashIcon}>{info.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trashDesc}>{e.description || info.label}</Text>
                      <Text style={styles.trashMeta}>{formatGNF(e.amount)} · supprimé le {deletedDate}</Text>
                    </View>
                    <TouchableOpacity style={styles.restoreBtn} onPress={() => handleRestore(e.id)}>
                      <Text style={styles.restoreText}>Restaurer</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setPurgeConfirmId(e.id)} style={{ padding: 4 }}>
                      <Ionicons name="close-circle" size={18} color={palette.critical} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null
        }
        SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />

      {/* Floating "+" — the screen itself is just the list; adding a
          dépense is a button tap away, not a permanently-open second tab. */}
      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Ionicons name="add" size={28} color={palette.white} />
      </TouchableOpacity>

      {/* ── Nouvelle/Modifier dépense — the whole simplified form, plus the
          photo-source picker as this same modal's own internal view (see
          formView's own comment above) rather than a second stacked
          AppModal. ── */}
      <AppModal
        visible={formModal}
        onClose={() => { setFormModal(false); resetForm(); }}
        title={
          formView === 'photoSource' ? 'Photo du reçu' :
          editingId ? 'Modifier la dépense' : 'Nouvelle dépense'
        }
      >
        {formView === 'fields' ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Montant (GNF)</Text>
            <MoneyInput
              style={styles.input}
              placeholder="Ex: 50 000"
              value={amount}
              onChangeText={setAmount}
              autoFocus
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={styles.input}
              placeholder="Carburant, loyer, salaire du gardien"
              placeholderTextColor={palette.muted}
              value={description}
              onChangeText={setDescription}
            />

            <Text style={styles.label}>Date de la dépense</Text>
            <View style={styles.dateRow}>
              {([
                ['hier', 'Hier'],
                ['aujourdhui', "Aujourd'hui"],
                ['autre', 'Autre date'],
              ] as const).map(([mode, label]) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.datePill, dateMode === mode && styles.datePillActive]}
                  onPress={() => selectDateMode(mode)}
                >
                  <Text style={[styles.datePillText, dateMode === mode && styles.datePillTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {dateMode === 'autre' && (
              <View style={{ marginTop: 10 }}>
                <DatePickerField label="Choisir une date" value={date} onChange={setDate} />
              </View>
            )}

            <Text style={styles.label}>Photo (optionnel)</Text>
            {photoUri ? (
              <TouchableOpacity style={styles.photoPreviewWrap} onPress={() => setFormView('photoSource')}>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setPhotoUri(null)}>
                  <Ionicons name="close-circle" size={22} color={palette.white} />
                </TouchableOpacity>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.photoAdd} onPress={() => setFormView('photoSource')}>
                <Ionicons name="image-outline" size={22} color={palette.muted} />
                <Text style={styles.photoAddText}>Ajouter une image</Text>
              </TouchableOpacity>
            )}

            <Button
              label={editingId ? 'Mettre à jour' : 'Enregistrer'}
              onPress={handleSave}
              loading={saving}
              fullWidth
              style={{ marginTop: 24 }}
            />
          </ScrollView>
        ) : (
          <>
            <TouchableOpacity style={[styles.sourceOption, Platform.OS === 'web' && styles.sourceOptionLast]} onPress={pickFromLibrary}>
              <Ionicons name="images-outline" size={22} color={palette.moss} style={{ marginRight: 14 }} />
              <Text style={styles.sourceOptionText}>Galerie photo</Text>
            </TouchableOpacity>
            {Platform.OS !== 'web' && (
              <TouchableOpacity style={[styles.sourceOption, styles.sourceOptionLast]} onPress={pickFromCamera}>
                <Ionicons name="camera-outline" size={22} color={palette.moss} style={{ marginRight: 14 }} />
                <Text style={styles.sourceOptionText}>Appareil photo</Text>
              </TouchableOpacity>
            )}
            <Button label="Retour" variant="ghost" onPress={() => setFormView('fields')} fullWidth style={{ marginTop: 10 }} />
          </>
        )}
      </AppModal>

      {/* ── Receipt viewer ── */}
      <AppModal visible={!!viewingPhotoUrl} onClose={() => setViewingPhotoUrl(null)} title="Reçu">
        {!!viewingPhotoUrl && (
          <Image source={{ uri: viewingPhotoUrl }} style={styles.receiptFull} resizeMode="contain" />
        )}
      </AppModal>

      {/* ── Delete confirm (soft) ── */}
      <ConfirmDialog
        visible={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
        title="Supprimer cette dépense ?"
        message="Elle sera conservée dans la corbeille pendant 30 jours, puis supprimée définitivement."
        confirmLabel="Supprimer"
        icon="trash-outline"
        tone="danger"
      />

      {/* ── Purge confirm (permanent) ── */}
      <ConfirmDialog
        visible={!!purgeConfirmId}
        onClose={() => setPurgeConfirmId(null)}
        onConfirm={confirmPurge}
        title="Supprimer définitivement ?"
        message="Cette action est irréversible. La dépense sera définitivement effacée."
        confirmLabel="Supprimer définitivement"
        icon="warning-outline"
        tone="danger"
      />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  summaryRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, paddingBottom: 8 },
  summaryPill: { backgroundColor: palette.mossSoft, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  summaryText: { fontSize: 13, fontWeight: '600', color: palette.moss },
  label: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: palette.card, borderRadius: 12, padding: 14, fontSize: 15, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  // date pills
  dateRow: { flexDirection: 'row', gap: 8 },
  datePill: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, alignItems: 'center' },
  datePillActive: { borderColor: palette.moss, backgroundColor: palette.moss },
  datePillText: { fontSize: 13, color: palette.muted, fontWeight: '600' },
  datePillTextActive: { color: palette.white },
  // photo
  photoAdd: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: palette.line, borderStyle: 'dashed', borderRadius: 12, padding: 20 },
  photoAddText: { fontSize: 14, color: palette.muted },
  photoPreviewWrap: { position: 'relative', alignSelf: 'flex-start' },
  photoPreview: { width: 120, height: 120, borderRadius: 12, backgroundColor: palette.line },
  photoRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: palette.critical, borderRadius: 12 },
  receiptFull: { width: '100%', height: 420, borderRadius: 12, backgroundColor: palette.line },
  // photo source sheet
  sourceOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: palette.line },
  sourceOptionLast: { borderBottomWidth: 0 },
  sourceOptionText: { fontSize: 16, color: palette.ink },
  // history list
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  sectionTotal: { fontSize: 14, fontWeight: '700', color: palette.ink },
  expenseCard: { backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  expenseMain: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expenseIcon: { fontSize: 28 },
  expenseDesc: { fontSize: 15, fontWeight: '600', color: palette.ink },
  expenseMeta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  expenseRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: palette.ink },
  lineItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 58, paddingVertical: 7, borderTopWidth: 1, borderColor: palette.line, backgroundColor: palette.paper },
  lineItemName: { fontSize: 13, color: palette.muted, flex: 1 },
  lineItemAmt: { fontSize: 13, fontWeight: '600', color: palette.ink },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15 },
  // trash
  trashSection: { marginTop: 24 },
  trashHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  trashTitle: { fontSize: 13, color: palette.muted, fontWeight: '600' },
  trashCard: { backgroundColor: palette.criticalSoft, borderRadius: 10, borderWidth: 1, borderColor: palette.critical + '30', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  trashIcon: { fontSize: 24 },
  trashDesc: { fontSize: 14, fontWeight: '600', color: palette.muted },
  trashMeta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  restoreBtn: { backgroundColor: palette.mossSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  restoreText: { fontSize: 12, color: palette.moss, fontWeight: '700' },
  // FAB
  fab: {
    position: 'absolute', right: 20, bottom: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
});
