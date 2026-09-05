import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, SectionList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Expense, CustomCategory, ExpenseLineItem, Purchase } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import {
  getExpenses, addExpense, updateExpense, deleteExpense, restoreExpense, purgeDeletedExpense,
  getDeletedExpenses, syncExpensesFromSupabase,
} from '../../store/expenses';
import { getPurchases, syncPurchasesFromSupabase } from '../../store/purchases';
import { getCustomCategories, addCustomCategory, deleteCustomCategory } from '../../store/customCategories';
import { getFactoryId } from '../../store/context';
import { formatGNF } from '../../utils/format';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog } from '../../components/ui';

const BUILT_IN: CustomCategory[] = [
  { key: 'loyer', label: 'Loyer', icon: '🏠' },
  { key: 'salaire', label: 'Salaire', icon: '👷' },
  { key: 'matiere_premiere', label: 'Matières premières', icon: '🥔' },
  { key: 'energie', label: 'Énergie / Gaz', icon: '⚡' },
  { key: 'transport', label: 'Transport', icon: '🚚' },
  { key: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { key: 'autre', label: 'Autre', icon: '📦' },
];

const EMOJI_GRID = [
  '💰','🏪','📱','🍽️','🌊','☀️','🔑','📦','🛒','🧹',
  '💡','🔌','📝','🎁','🏭','🧪','🌿','🍳','🥤','🧴',
  '🚗','✈️','🏥','📚','🎓','💻','📞','🔒','🛠️','🌍',
];

// History view type: 'depenses' = expenses only, 'tout' = expenses + purchases
type HistoryView = 'depenses' | 'tout';

// Unified spending row shown in the "Tout" view
type SpendingRow =
  | { kind: 'expense'; data: Expense }
  | { kind: 'purchase'; data: Purchase };

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

interface LineItemRow { id: string; name: string; qty: string; amount: string; }
function makeLine(): LineItemRow { return { id: Math.random().toString(36).slice(2), name: '', qty: '', amount: '' }; }
function lineTotal(line: LineItemRow): number {
  const q = parseInt(line.qty, 10);
  const a = parseNum(line.amount);
  return q > 0 ? q * a : a;
}

export default function ExpensesScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deletedExpenses, setDeletedExpenses] = useState<Expense[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [tab, setTab] = useState<'add' | 'history'>('add');
  const [historyView, setHistoryView] = useState<HistoryView>('depenses');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Edit mode ─────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Form state ────────────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('autre');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'orange_money'>('cash');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [amount, setAmount] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);

  // ── Batch add feedback ────────────────────────────────────────
  const [lastSavedAmount, setLastSavedAmount] = useState<number | null>(null);

  // ── Delete confirm modal ──────────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);

  // ── Category modals ───────────────────────────────────────────
  const [catModal, setCatModal] = useState(false);
  const [addCatModal, setAddCatModal] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('');

  const allCats = [...BUILT_IN, ...customCats];

  // ── Draft persistence (only when not editing) ─────────────────
  const draftKey = `expense_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingId) return;
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.description) setDescription(d.description);
        if (d.amount) setAmount(d.amount);
        if (d.category) setCategory(d.category);
        if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
        if (d.date) setDate(d.date);
        if (d.lineItems?.length) setLineItems(d.lineItems);
      } catch { /* corrupt draft */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = useCallback(() => {
    if (editingId) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ description, amount, category, paymentMethod, date, lineItems }));
    }, 400);
  }, [description, amount, category, paymentMethod, date, lineItems, draftKey, editingId]);

  useEffect(() => { saveDraft(); }, [saveDraft]);

  function clearForm(keepDate = false) {
    setEditingId(null);
    setDescription(''); setAmount(''); setCategory('autre');
    setPaymentMethod('cash');
    if (!keepDate) setDate(toDateStr(new Date()));
    setLineItems([]);
    setLastSavedAmount(null);
    AsyncStorage.removeItem(draftKey);
  }

  // ── Load data ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    syncExpensesFromSupabase();
    syncPurchasesFromSupabase();
    const [exp, cats, del, purch] = await Promise.all([
      getExpenses(), getCustomCategories(), getDeletedExpenses(), getPurchases(),
    ]);
    setExpenses(exp);
    setCustomCats(cats);
    setDeletedExpenses(del);
    setPurchases(purch);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Line item helpers ──────────────────────────────────────────
  const hasLines = lineItems.length > 0;
  const totalLineItems = lineItems.reduce((s, l) => s + lineTotal(l), 0);
  const totalAmount = hasLines ? totalLineItems : parseNum(amount);

  function updateLine(id: string, field: keyof Omit<LineItemRow, 'id'>, val: string) {
    setLineItems(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
  }
  function removeLine(id: string) {
    setLineItems(prev => prev.filter(l => l.id !== id));
  }

  // ── Open expense for editing ───────────────────────────────────
  function openEdit(expense: Expense) {
    setEditingId(expense.id);
    setDescription(expense.description);
    setCategory(expense.category);
    setPaymentMethod(expense.paymentMethod);
    setDate(expense.date);
    if (expense.lineItems?.length) {
      setLineItems(expense.lineItems.map(li => ({
        id: Math.random().toString(36).slice(2),
        name: li.name,
        qty: li.quantity ? String(li.quantity) : '',
        amount: li.quantity ? String(Math.round(li.amount / li.quantity)) : String(li.amount),
      })));
      setAmount('');
    } else {
      setLineItems([]);
      setAmount(String(expense.amount));
    }
    setTab('add');
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSave(addAnother = false) {
    if (!description.trim()) return;
    if (totalAmount <= 0) return;

    const validLines: ExpenseLineItem[] = lineItems
      .filter(l => l.name.trim() && parseNum(l.amount) > 0)
      .map(l => {
        const q = parseInt(l.qty, 10);
        const unitPrice = parseNum(l.amount);
        return { name: l.name.trim(), amount: q > 0 ? q * unitPrice : unitPrice, quantity: q > 0 ? q : undefined };
      });

    if (editingId) {
      await updateExpense(editingId, {
        date, category, description: description.trim(), amount: totalAmount, paymentMethod,
        lineItems: validLines.length > 0 ? validLines : undefined,
      });
      clearForm();
      await load();
    } else {
      const savedDate = date;
      const savedAmount = totalAmount;
      const item = await addExpense({
        date, category, description: description.trim(), amount: totalAmount, paymentMethod,
        lineItems: validLines.length > 0 ? validLines : undefined,
      });
      setExpenses(prev => [item, ...prev]);
      if (addAnother) {
        // Keep date, reset the rest
        setEditingId(null);
        setDescription(''); setAmount(''); setCategory('autre');
        setPaymentMethod('cash'); setLineItems([]);
        setDate(savedDate);
        setLastSavedAmount(savedAmount);
        AsyncStorage.removeItem(draftKey);
      } else {
        clearForm();
      }
    }
  }

  // ── Delete (soft) ─────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteConfirmId) return;
    await deleteExpense(deleteConfirmId);
    setExpenses(prev => prev.filter(e => e.id !== deleteConfirmId));
    const del = await getDeletedExpenses();
    setDeletedExpenses(del);
    if (editingId === deleteConfirmId) clearForm();
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

  // ── Category ──────────────────────────────────────────────────
  async function handleAddCategory() {
    if (!newCatLabel.trim()) return;
    const cat = await addCustomCategory(newCatLabel, newCatEmoji || '📦');
    setCustomCats(prev => [...prev, cat]);
    setCategory(cat.key);
    setNewCatLabel(''); setNewCatEmoji('');
    setAddCatModal(false); setCatModal(false);
  }
  async function handleDeleteCat(key: string) {
    await deleteCustomCategory(key);
    setCustomCats(prev => prev.filter(c => c.key !== key));
    if (category === key) setCategory('autre');
  }

  // ── Summary pill ───────────────────────────────────────────────
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthTotal = expenses.filter(e => e.date >= monthStart).reduce((s, e) => s + e.amount, 0);
  const monthPurchases = purchases.filter(p => p.date >= monthStart).reduce((s, p) => s + p.totalAmount, 0);

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

  // ── Group combined (expenses + purchases) by month ─────────────
  const combinedGrouped: Record<string, SpendingRow[]> = {};
  for (const e of expenses) {
    const k = monthKey(e.date);
    if (!combinedGrouped[k]) combinedGrouped[k] = [];
    combinedGrouped[k].push({ kind: 'expense', data: e });
  }
  for (const p of purchases) {
    const k = monthKey(p.date);
    if (!combinedGrouped[k]) combinedGrouped[k] = [];
    combinedGrouped[k].push({ kind: 'purchase', data: p });
  }
  const combinedSections = Object.keys(combinedGrouped)
    .sort((a, b) => b.localeCompare(a))
    .map(ym => {
      const rows = combinedGrouped[ym].sort((a, b) => {
        const da = a.kind === 'expense' ? a.data.date : a.data.date;
        const db = b.kind === 'expense' ? b.data.date : b.data.date;
        return db.localeCompare(da);
      });
      const total = rows.reduce((s, r) => s + (r.kind === 'expense' ? r.data.amount : r.data.totalAmount), 0);
      return { title: ym, total, data: rows };
    });

  const { label: catLabel, icon: catIcon } = catInfo(category, allCats);

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryText}>Ce mois : {formatGNF(monthTotal)}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'add' && styles.tabActive]} onPress={() => setTab('add')}>
          <Text style={[styles.tabText, tab === 'add' && styles.tabTextActive]}>
            {editingId ? 'Modifier' : 'Ajouter'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'history' && styles.tabActive]} onPress={() => setTab('history')}>
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>Historique</Text>
        </TouchableOpacity>
      </View>

      {tab === 'add' ? (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {!!lastSavedAmount && !editingId && (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={16} color={palette.moss} />
              <Text style={styles.successText}>{formatGNF(lastSavedAmount)} enregistré — ajoutez une autre dépense à la même date</Text>
            </View>
          )}

          {!!editingId && (
            <View style={styles.editBanner}>
              <Ionicons name="pencil" size={14} color={palette.caution} />
              <Text style={styles.editBannerText}>Mode modification</Text>
              <TouchableOpacity onPress={() => clearForm()}>
                <Text style={styles.editCancelText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Date first — key for batch add */}
          <DatePickerField label="Date" value={date} onChange={setDate} />

          {/* Category */}
          <Text style={styles.label}>Catégorie</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setCatModal(true)}>
            <Text style={styles.pickerText}>{catIcon}  {catLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={palette.muted} />
          </TouchableOpacity>

          {/* Title */}
          <Text style={styles.label}>Titre / Description</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Achats du marché, Loyer mai…"
            placeholderTextColor={palette.muted}
            value={description}
            onChangeText={setDescription}
          />

          {/* Line items (receipt mode) */}
          <View style={styles.lineHeader}>
            <Text style={styles.label}>Articles / Lignes</Text>
            <TouchableOpacity style={styles.addLineBtn} onPress={() => setLineItems(prev => [...prev, makeLine()])}>
              <Ionicons name="add-circle-outline" size={20} color={palette.moss} />
              <Text style={styles.addLineTxt}>Ajouter</Text>
            </TouchableOpacity>
          </View>

          {lineItems.length === 0 && (
            <TouchableOpacity style={styles.emptyLines} onPress={() => setLineItems([makeLine()])}>
              <Ionicons name="receipt-outline" size={20} color={palette.muted} />
              <Text style={styles.emptyLinesTxt}>Ajouter les articles d'un reçu</Text>
            </TouchableOpacity>
          )}

          {lineItems.map((line, idx) => (
            <View key={line.id} style={styles.lineBlock}>
              <View style={styles.lineRow}>
                <Text style={styles.lineNum}>{idx + 1}</Text>
                <TextInput
                  style={[styles.input, styles.lineName]}
                  placeholder="Article…"
                  placeholderTextColor={palette.muted}
                  value={line.name}
                  onChangeText={v => updateLine(line.id, 'name', v)}
                />
                <TouchableOpacity onPress={() => removeLine(line.id)} style={styles.lineDelete}>
                  <Ionicons name="close-circle" size={20} color={palette.critical} />
                </TouchableOpacity>
              </View>
              <View style={styles.lineAmtRow}>
                <View style={styles.qtyWrap}>
                  <Text style={styles.qtyLabel}>Qté</Text>
                  <TextInput
                    style={[styles.input, styles.qtyInput]}
                    placeholder="—"
                    placeholderTextColor={palette.muted}
                    keyboardType="numeric"
                    value={line.qty}
                    onChangeText={v => updateLine(line.id, 'qty', v)}
                  />
                </View>
                <Text style={styles.qtyX}>×</Text>
                <View style={styles.priceWrap}>
                  <Text style={styles.qtyLabel}>Prix unit. (GNF)</Text>
                  <TextInput
                    style={[styles.input, styles.lineAmt]}
                    placeholder="0"
                    placeholderTextColor={palette.muted}
                    keyboardType="numeric"
                    value={line.amount}
                    onChangeText={v => updateLine(line.id, 'amount', v)}
                  />
                </View>
                <View style={styles.lineTotalWrap}>
                  <Text style={styles.qtyLabel}>Total</Text>
                  <Text style={styles.lineTotalVal}>{formatGNF(lineTotal(line))}</Text>
                </View>
              </View>
            </View>
          ))}

          {hasLines ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatGNF(totalLineItems)}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Montant total (GNF)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 50 000"
                placeholderTextColor={palette.muted}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </>
          )}

          {/* Payment method */}
          <Text style={styles.label}>Mode de paiement</Text>
          <View style={styles.row}>
            {(['cash', 'orange_money'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.methodBtn, paymentMethod === m && styles.methodBtnActive]}
                onPress={() => setPaymentMethod(m)}
              >
                <Text style={[styles.methodText, paymentMethod === m && styles.methodTextActive]}>
                  {m === 'cash' ? 'Cash' : 'Orange Money'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Save buttons */}
          {!editingId ? (
            <>
              <TouchableOpacity style={styles.addBtn} onPress={() => handleSave(false)}>
                <Text style={styles.addBtnText}>
                  Enregistrer — {totalAmount > 0 ? formatGNF(totalAmount) : '…'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addAnotherBtn} onPress={() => handleSave(true)}>
                <Ionicons name="add-circle-outline" size={18} color={palette.moss} />
                <Text style={styles.addAnotherText}>
                  Enregistrer et ajouter une autre (même date)
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.addBtn} onPress={() => handleSave(false)}>
              <Text style={styles.addBtnText}>
                Mettre à jour — {totalAmount > 0 ? formatGNF(totalAmount) : '…'}
              </Text>
            </TouchableOpacity>
          )}

          {!editingId && (description || amount || lineItems.length > 0) && (
            <TouchableOpacity style={styles.discardBtn} onPress={() => clearForm()}>
              <Text style={styles.discardTxt}>Effacer le brouillon</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : (
        /* ── History tab ───────────────────────────────────────── */
        <View style={{ flex: 1 }}>
          {/* Toggle: Dépenses / Tout */}
          <View style={styles.historyToggleBar}>
            <TouchableOpacity
              style={[styles.historyToggleBtn, historyView === 'depenses' && styles.historyToggleBtnActive]}
              onPress={() => setHistoryView('depenses')}
            >
              <Text style={[styles.historyToggleText, historyView === 'depenses' && styles.historyToggleTextActive]}>
                Dépenses ({expenses.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.historyToggleBtn, historyView === 'tout' && styles.historyToggleBtnActive]}
              onPress={() => setHistoryView('tout')}
            >
              <Text style={[styles.historyToggleText, historyView === 'tout' && styles.historyToggleTextActive]}>
                Tout dépenser ({expenses.length + purchases.length})
              </Text>
            </TouchableOpacity>
          </View>

          {historyView === 'tout' && (
            <View style={styles.allSpendingSummary}>
              <Text style={styles.allSpendingLabel}>Ce mois — dépenses + achats</Text>
              <Text style={styles.allSpendingValue}>{formatGNF(monthTotal + monthPurchases)}</Text>
            </View>
          )}

          {historyView === 'depenses' ? (
            <SectionList
              sections={expenseSections}
              keyExtractor={e => e.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée</Text>}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{monthLabel(section.title)}</Text>
                  <Text style={styles.sectionTotal}>{formatGNF(section.total)}</Text>
                </View>
              )}
              renderItem={({ item }) => {
                const info = catInfo(item.category, allCats);
                const isExpanded = expandedId === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.expenseCard, editingId === item.id && styles.expenseCardEditing]}
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
          ) : (
            /* ── Combined view ── */
            <SectionList
              sections={combinedSections}
              keyExtractor={(row, i) => (row.kind === 'expense' ? row.data.id : `p-${row.data.id}-${i}`)}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée</Text>}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{monthLabel(section.title)}</Text>
                  <Text style={styles.sectionTotal}>{formatGNF(section.total)}</Text>
                </View>
              )}
              renderItem={({ item: row }) => {
                if (row.kind === 'expense') {
                  const e = row.data;
                  const info = catInfo(e.category, allCats);
                  return (
                    <View style={styles.expenseCard}>
                      <View style={styles.expenseMain}>
                        <Text style={styles.expenseIcon}>{info.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.expenseDesc}>{e.description || info.label}</Text>
                          <Text style={styles.expenseMeta}>{info.label} · {e.date}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Text style={styles.expenseAmount}>{formatGNF(e.amount)}</Text>
                          <View style={styles.tagDep}><Text style={styles.tagText}>Dépense</Text></View>
                        </View>
                      </View>
                    </View>
                  );
                } else {
                  const p = row.data;
                  return (
                    <View style={[styles.expenseCard, { borderLeftWidth: 3, borderLeftColor: palette.caution }]}>
                      <View style={styles.expenseMain}>
                        <Text style={styles.expenseIcon}>🛒</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.expenseDesc}>{p.product}</Text>
                          <Text style={styles.expenseMeta}>{p.supplierName} · {p.quantity} {p.unit} · {p.date}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Text style={styles.expenseAmount}>{formatGNF(p.totalAmount)}</Text>
                          <View style={styles.tagAchat}><Text style={styles.tagText}>Achat</Text></View>
                        </View>
                      </View>
                    </View>
                  );
                }
              }}
              SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
          )}
        </View>
      )}

      {/* ── Category picker ── */}
      <AppModal visible={catModal} onClose={() => setCatModal(false)} title="Catégorie">
        <TouchableOpacity onPress={() => setAddCatModal(true)} style={styles.addCatBtn}>
          <Ionicons name="add" size={20} color={palette.moss} />
          <Text style={styles.addCatText}>Nouvelle catégorie</Text>
        </TouchableOpacity>
        <ScrollView style={{ maxHeight: 400 }}>
          {allCats.map(c => (
            <TouchableOpacity
              key={c.key}
              style={[styles.sheetRow, category === c.key && styles.sheetRowActive]}
              onPress={() => { setCategory(c.key); setCatModal(false); }}
            >
              <Text style={styles.sheetIcon}>{c.icon}</Text>
              <Text style={styles.sheetLabel}>{c.label}</Text>
              {category === c.key && <Ionicons name="checkmark" size={18} color={palette.moss} />}
              {!BUILT_IN.find(b => b.key === c.key) && (
                <TouchableOpacity onPress={() => handleDeleteCat(c.key)} style={{ padding: 4, marginLeft: 4 }}>
                  <Ionicons name="trash-outline" size={16} color={palette.critical} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </AppModal>

      {/* ── Add custom category ── */}
      <AppModal visible={addCatModal} onClose={() => { setAddCatModal(false); setNewCatLabel(''); setNewCatEmoji(''); }} title="Nouvelle catégorie">
        <Text style={styles.fieldLabel}>Nom</Text>
        <TextInput style={styles.input} placeholder="Ex: Marketing, Eau…" placeholderTextColor={palette.muted} value={newCatLabel} onChangeText={setNewCatLabel} />
        <Text style={styles.fieldLabel}>Emoji</Text>
        <TextInput style={[styles.input, styles.emojiInput]} placeholder="🏷️" value={newCatEmoji} onChangeText={v => setNewCatEmoji(v.slice(-2))} maxLength={2} />
        <View style={styles.emojiGrid}>
          {EMOJI_GRID.map(e => (
            <TouchableOpacity key={e} style={[styles.emojiCell, newCatEmoji === e && styles.emojiCellActive]} onPress={() => setNewCatEmoji(e)}>
              <Text style={styles.emojiCellText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Button label="Créer" onPress={handleAddCategory} fullWidth style={{ marginTop: 20 }} />
        <Button
          label="Annuler"
          variant="ghost"
          onPress={() => { setAddCatModal(false); setNewCatLabel(''); setNewCatEmoji(''); }}
          fullWidth
          style={{ marginTop: 10 }}
        />
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
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: palette.paper, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: palette.card },
  tabText: { fontSize: 14, color: palette.muted, fontWeight: '500' },
  tabTextActive: { color: palette.ink, fontWeight: '700' },
  form: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: palette.card, borderRadius: 12, padding: 14, fontSize: 15, color: palette.ink, borderWidth: 1, borderColor: palette.line },
  picker: { backgroundColor: palette.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 16, color: palette.ink },
  // banners
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.mossSoft, borderRadius: 10, padding: 12, marginBottom: 4 },
  successText: { flex: 1, fontSize: 13, color: palette.moss, fontWeight: '500' },
  editBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.cautionSoft, borderRadius: 10, padding: 12, marginBottom: 4 },
  editBannerText: { flex: 1, fontSize: 13, color: palette.caution, fontWeight: '500' },
  editCancelText: { fontSize: 13, color: palette.critical, fontWeight: '600' },
  // line items
  lineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addLineTxt: { fontSize: 14, fontWeight: '600', color: palette.moss },
  emptyLines: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: palette.line, borderStyle: 'dashed', borderRadius: 12, padding: 14, justifyContent: 'center' },
  emptyLinesTxt: { fontSize: 14, color: palette.muted },
  lineBlock: { marginBottom: 10, backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.line, padding: 10, gap: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineNum: { fontSize: 13, color: palette.muted, width: 18, textAlign: 'center' },
  lineName: { flex: 1, marginBottom: 0, paddingVertical: 10 },
  lineDelete: { padding: 4 },
  lineAmtRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  qtyWrap: { alignItems: 'center', width: 56 },
  qtyLabel: { fontSize: 10, color: palette.muted, marginBottom: 4 },
  qtyInput: { width: 56, paddingVertical: 10, textAlign: 'center', marginBottom: 0 },
  qtyX: { fontSize: 18, color: palette.muted, marginBottom: 8 },
  priceWrap: { flex: 1, alignItems: 'flex-start' },
  lineAmt: { width: '100%', marginBottom: 0, paddingVertical: 10 },
  lineTotalWrap: { alignItems: 'flex-end', minWidth: 72 },
  lineTotalVal: { fontSize: 13, fontWeight: '700', color: palette.moss, marginBottom: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: palette.line },
  totalLabel: { fontSize: 15, fontWeight: '700', color: palette.ink },
  totalValue: { fontSize: 18, fontWeight: '800', color: palette.moss },
  row: { flexDirection: 'row', gap: 10 },
  methodBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, alignItems: 'center' },
  methodBtnActive: { borderColor: palette.moss, backgroundColor: palette.mossSoft },
  methodText: { fontSize: 14, color: palette.muted, fontWeight: '500' },
  methodTextActive: { color: palette.moss, fontWeight: '700' },
  addBtn: { marginTop: 24, backgroundColor: palette.moss, borderRadius: 14, padding: 16, alignItems: 'center' },
  addBtnText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  addAnotherBtn: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: palette.moss, borderRadius: 14, padding: 14 },
  addAnotherText: { color: palette.moss, fontSize: 14, fontWeight: '600' },
  discardBtn: { marginTop: 12, alignItems: 'center', padding: 10 },
  discardTxt: { fontSize: 13, color: palette.muted },
  // history view toggle
  historyToggleBar: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: palette.paper, borderRadius: 10, padding: 3 },
  historyToggleBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  historyToggleBtnActive: { backgroundColor: palette.card },
  historyToggleText: { fontSize: 12, color: palette.muted, fontWeight: '500' },
  historyToggleTextActive: { color: palette.ink, fontWeight: '700' },
  allSpendingSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: palette.cautionSoft, borderRadius: 10, padding: 12 },
  allSpendingLabel: { fontSize: 13, color: palette.caution, fontWeight: '600' },
  allSpendingValue: { fontSize: 14, color: palette.caution, fontWeight: '700' },
  // history list
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  sectionTotal: { fontSize: 14, fontWeight: '700', color: palette.critical },
  expenseCard: { backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  expenseCardEditing: { borderColor: palette.caution, borderWidth: 2 },
  expenseMain: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expenseIcon: { fontSize: 28 },
  expenseDesc: { fontSize: 15, fontWeight: '600', color: palette.ink },
  expenseMeta: { fontSize: 12, color: palette.muted, marginTop: 2 },
  expenseRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: palette.critical },
  lineItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 58, paddingVertical: 7, borderTopWidth: 1, borderColor: palette.line, backgroundColor: palette.paper },
  lineItemName: { fontSize: 13, color: palette.muted, flex: 1 },
  lineItemAmt: { fontSize: 13, fontWeight: '600', color: palette.ink },
  empty: { textAlign: 'center', color: palette.muted, marginTop: 40, fontSize: 15 },
  // tags
  tagDep: { backgroundColor: palette.mossSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagAchat: { backgroundColor: palette.cautionSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 10, fontWeight: '700', color: palette.muted },
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
  // category sheet
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: palette.mossSoft, alignSelf: 'flex-start', marginBottom: 12 },
  addCatText: { fontSize: 13, fontWeight: '600', color: palette.moss },
  sheetRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 4 },
  sheetRowActive: { backgroundColor: palette.mossSoft },
  sheetIcon: { fontSize: 24, marginRight: 14 },
  sheetLabel: { flex: 1, fontSize: 16, color: palette.ink },
  // add category modal
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 12 },
  emojiInput: { fontSize: 28, textAlign: 'center', paddingVertical: 10 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  emojiCell: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper },
  emojiCellActive: { backgroundColor: palette.mossSoft, borderWidth: 2, borderColor: palette.moss },
  emojiCellText: { fontSize: 22 },
});
