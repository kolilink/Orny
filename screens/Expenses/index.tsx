import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Expense, CustomCategory, ExpenseLineItem } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getExpenses, addExpense, updateExpense, deleteExpense, syncExpensesFromSupabase } from '../../store/expenses';
import { getCustomCategories, addCustomCategory, deleteCustomCategory } from '../../store/customCategories';
import { getFactoryId } from '../../store/context';
import { formatGNF } from '../../utils/format';

const C = {
  primary: '#1D9E75', red: '#E24B4A', orange: '#EF9F27',
  bg: '#F8F8F6', card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

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
  const insets = useSafeAreaInsets();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [tab, setTab] = useState<'add' | 'history'>('add');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Edit mode ───────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('autre');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'orange_money'>('cash');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [amount, setAmount] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);

  // ── Modals ──────────────────────────────────────────────────────
  const [catModal, setCatModal] = useState(false);
  const [addCatModal, setAddCatModal] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('');

  const allCats = [...BUILT_IN, ...customCats];

  // ── Draft persistence (only when not editing) ───────────────────
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
      } catch { /* corrupt draft — ignore */ }
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

  function clearForm() {
    setEditingId(null);
    setDescription(''); setAmount(''); setCategory('autre');
    setPaymentMethod('cash'); setDate(toDateStr(new Date()));
    setLineItems([]);
    AsyncStorage.removeItem(draftKey);
  }

  // ── Load data ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    syncExpensesFromSupabase();
    const [exp, cats] = await Promise.all([getExpenses(), getCustomCategories()]);
    setExpenses(exp);
    setCustomCats(cats);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Line item helpers ───────────────────────────────────────────
  const hasLines = lineItems.length > 0;
  const totalLineItems = lineItems.reduce((s, l) => s + lineTotal(l), 0);
  const totalAmount = hasLines ? totalLineItems : parseNum(amount);

  function updateLine(id: string, field: keyof Omit<LineItemRow, 'id'>, val: string) {
    setLineItems(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
  }
  function removeLine(id: string) {
    setLineItems(prev => prev.filter(l => l.id !== id));
  }

  // ── Open expense for editing ────────────────────────────────────
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

  // ── Submit ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!description.trim()) return Alert.alert('Erreur', 'Ajoutez un titre / description.');
    if (totalAmount <= 0) return Alert.alert('Erreur', hasLines ? 'Ajoutez au moins un article avec un montant.' : 'Montant invalide.');

    const validLines: ExpenseLineItem[] = lineItems
      .filter(l => l.name.trim() && parseNum(l.amount) > 0)
      .map(l => {
        const q = parseInt(l.qty, 10);
        const unitPrice = parseNum(l.amount);
        return {
          name: l.name.trim(),
          amount: q > 0 ? q * unitPrice : unitPrice,
          quantity: q > 0 ? q : undefined,
        };
      });

    if (editingId) {
      await updateExpense(editingId, {
        date,
        category,
        description: description.trim(),
        amount: totalAmount,
        paymentMethod,
        lineItems: validLines.length > 0 ? validLines : undefined,
      });
      clearForm();
      await load();
      Alert.alert('Dépense mise à jour', `${formatGNF(totalAmount)} enregistré.`);
    } else {
      const item = await addExpense({
        date,
        category,
        description: description.trim(),
        amount: totalAmount,
        paymentMethod,
        lineItems: validLines.length > 0 ? validLines : undefined,
      });
      clearForm();
      setExpenses(prev => [item, ...prev]);
      Alert.alert('Dépense ajoutée', `${formatGNF(totalAmount)} enregistré.`);
    }
  }

  async function handleDelete(id: string) {
    Alert.alert('Supprimer ?', 'Cette dépense sera définitivement supprimée.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await deleteExpense(id);
        setExpenses(prev => prev.filter(e => e.id !== id));
        if (editingId === id) clearForm();
      }},
    ]);
  }

  // ── Category ─────────────────────────────────────────────────────
  async function handleAddCategory() {
    if (!newCatLabel.trim()) return Alert.alert('Erreur', 'Entrez un nom.');
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

  // ── Summary pill ─────────────────────────────────────────────────
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthTotal = expenses.filter(e => e.date >= monthStart).reduce((s, e) => s + e.amount, 0);

  // ── Group history by month ────────────────────────────────────────
  const grouped: Record<string, Expense[]> = {};
  for (const e of expenses) {
    const k = monthKey(e.date);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const sections = Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .map(ym => ({
      title: ym,
      total: grouped[ym].reduce((s, e) => s + e.amount, 0),
      data: grouped[ym].sort((a, b) => b.date.localeCompare(a.date)),
    }));

  const { label: catLabel, icon: catIcon } = catInfo(category, allCats);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Dépenses</Text>
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
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>Historique ({expenses.length})</Text>
        </TouchableOpacity>
      </View>

      {tab === 'add' ? (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {!!editingId && (
            <View style={styles.editBanner}>
              <Ionicons name="pencil" size={14} color={C.orange} />
              <Text style={styles.editBannerText}>Mode modification — enregistrez pour mettre à jour</Text>
              <TouchableOpacity onPress={clearForm}>
                <Text style={styles.editCancelText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Category */}
          <Text style={styles.label}>Catégorie</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setCatModal(true)}>
            <Text style={styles.pickerText}>{catIcon}  {catLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={C.muted} />
          </TouchableOpacity>

          {/* Title */}
          <Text style={styles.label}>Titre / Description</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Achats du marché, Loyer mai…"
            placeholderTextColor={C.muted}
            value={description}
            onChangeText={setDescription}
          />

          {/* ── Line items (receipt mode) ── */}
          <View style={styles.lineHeader}>
            <Text style={styles.label}>Articles / Lignes</Text>
            <TouchableOpacity style={styles.addLineBtn} onPress={() => setLineItems(prev => [...prev, makeLine()])}>
              <Ionicons name="add-circle-outline" size={20} color={C.primary} />
              <Text style={styles.addLineTxt}>Ajouter</Text>
            </TouchableOpacity>
          </View>

          {lineItems.length === 0 && (
            <TouchableOpacity style={styles.emptyLines} onPress={() => setLineItems([makeLine()])}>
              <Ionicons name="receipt-outline" size={20} color={C.muted} />
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
                  placeholderTextColor={C.muted}
                  value={line.name}
                  onChangeText={v => updateLine(line.id, 'name', v)}
                />
                <TouchableOpacity onPress={() => removeLine(line.id)} style={styles.lineDelete}>
                  <Ionicons name="close-circle" size={20} color={C.red} />
                </TouchableOpacity>
              </View>
              <View style={styles.lineAmtRow}>
                <View style={styles.qtyWrap}>
                  <Text style={styles.qtyLabel}>Qté</Text>
                  <TextInput
                    style={[styles.input, styles.qtyInput]}
                    placeholder="—"
                    placeholderTextColor={C.muted}
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
                    placeholderTextColor={C.muted}
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

          {/* Total line or manual amount */}
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
                placeholderTextColor={C.muted}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </>
          )}

          <DatePickerField label="Date" value={date} onChange={setDate} />

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

          <TouchableOpacity style={styles.addBtn} onPress={handleSave}>
            <Text style={styles.addBtnText}>
              {editingId ? `Mettre à jour — ${totalAmount > 0 ? formatGNF(totalAmount) : '…'}` : `Enregistrer — ${totalAmount > 0 ? formatGNF(totalAmount) : '…'}`}
            </Text>
          </TouchableOpacity>

          {!editingId && (description || amount || lineItems.length > 0) && (
            <TouchableOpacity style={styles.discardBtn} onPress={() => {
              Alert.alert('Effacer le brouillon ?', '', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Effacer', style: 'destructive', onPress: clearForm },
              ]);
            }}>
              <Text style={styles.discardTxt}>Effacer le brouillon</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={e => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
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
                onPress={() => item.lineItems?.length ? setExpandedId(isExpanded ? null : item.id) : null}
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
                      <Ionicons name="pencil-outline" size={16} color={C.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(item.id)} style={{ padding: 4 }}>
                      <Ionicons name="trash-outline" size={16} color={C.red} />
                    </TouchableOpacity>
                  </View>
                </View>
                {isExpanded && item.lineItems?.map((li, i) => (
                  <View key={i} style={styles.lineItemRow}>
                    <Text style={styles.lineItemName}>
                      {li.quantity ? `${li.quantity} × ` : ''}{li.name}
                    </Text>
                    <Text style={styles.lineItemAmt}>{formatGNF(li.amount)}</Text>
                  </View>
                ))}
              </TouchableOpacity>
            );
          }}
          SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      {/* ── Category picker ── */}
      <Modal visible={catModal} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setCatModal(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Catégorie</Text>
            <TouchableOpacity onPress={() => setAddCatModal(true)} style={styles.addCatBtn}>
              <Ionicons name="add" size={20} color={C.primary} />
              <Text style={styles.addCatText}>Nouvelle</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 400 }}>
            {allCats.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.sheetRow, category === c.key && styles.sheetRowActive]}
                onPress={() => { setCategory(c.key); setCatModal(false); }}
              >
                <Text style={styles.sheetIcon}>{c.icon}</Text>
                <Text style={styles.sheetLabel}>{c.label}</Text>
                {category === c.key && <Ionicons name="checkmark" size={18} color={C.primary} />}
                {!BUILT_IN.find(b => b.key === c.key) && (
                  <TouchableOpacity onPress={() => handleDeleteCat(c.key)} style={{ padding: 4, marginLeft: 4 }}>
                    <Ionicons name="trash-outline" size={16} color={C.red} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Add custom category ── */}
      <Modal visible={addCatModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Nouvelle catégorie</Text>
            <Text style={styles.fieldLabel}>Nom</Text>
            <TextInput style={styles.input} placeholder="Ex: Marketing, Eau…" placeholderTextColor={C.muted}
              value={newCatLabel} onChangeText={setNewCatLabel} />
            <Text style={styles.fieldLabel}>Emoji</Text>
            <TextInput style={[styles.input, styles.emojiInput]} placeholder="🏷️"
              value={newCatEmoji} onChangeText={v => setNewCatEmoji(v.slice(-2))} maxLength={2} />
            <View style={styles.emojiGrid}>
              {EMOJI_GRID.map(e => (
                <TouchableOpacity key={e} style={[styles.emojiCell, newCatEmoji === e && styles.emojiCellActive]}
                  onPress={() => setNewCatEmoji(e)}>
                  <Text style={styles.emojiCellText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleAddCategory}>
              <Text style={styles.confirmBtnText}>Créer la catégorie</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setAddCatModal(false); setNewCatLabel(''); setNewCatEmoji(''); }}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  summaryPill: { backgroundColor: '#E8F6F0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  summaryText: { fontSize: 13, fontWeight: '600', color: C.primary },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: '#EDEDEB', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: C.card },
  tabText: { fontSize: 14, color: C.muted, fontWeight: '500' },
  tabTextActive: { color: C.text, fontWeight: '700' },
  form: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: C.card, borderRadius: 12, padding: 14, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.border },
  picker: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 16, color: C.text },
  // edit banner
  editBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF4E4', borderRadius: 10, padding: 12, marginBottom: 4 },
  editBannerText: { flex: 1, fontSize: 13, color: C.orange, fontWeight: '500' },
  editCancelText: { fontSize: 13, color: C.red, fontWeight: '600' },
  // line items
  lineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addLineTxt: { fontSize: 14, fontWeight: '600', color: C.primary },
  emptyLines: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', borderRadius: 12, padding: 14, justifyContent: 'center' },
  emptyLinesTxt: { fontSize: 14, color: C.muted },
  lineBlock: { marginBottom: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, gap: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineNum: { fontSize: 13, color: C.muted, width: 18, textAlign: 'center' },
  lineName: { flex: 1, marginBottom: 0, paddingVertical: 10 },
  lineDelete: { padding: 4 },
  lineAmtRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  qtyWrap: { alignItems: 'center', width: 56 },
  qtyLabel: { fontSize: 10, color: C.muted, marginBottom: 4 },
  qtyInput: { width: 56, paddingVertical: 10, textAlign: 'center', marginBottom: 0 },
  qtyX: { fontSize: 18, color: C.muted, marginBottom: 8 },
  priceWrap: { flex: 1, alignItems: 'flex-start' },
  lineAmt: { width: '100%', marginBottom: 0, paddingVertical: 10 },
  lineTotalWrap: { alignItems: 'flex-end', minWidth: 72 },
  lineTotalVal: { fontSize: 13, fontWeight: '700', color: C.primary, marginBottom: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: C.border },
  totalLabel: { fontSize: 15, fontWeight: '700', color: C.text },
  totalValue: { fontSize: 18, fontWeight: '800', color: C.primary },
  row: { flexDirection: 'row', gap: 10 },
  methodBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center' },
  methodBtnActive: { borderColor: C.primary, backgroundColor: '#E8F6F0' },
  methodText: { fontSize: 14, color: C.muted, fontWeight: '500' },
  methodTextActive: { color: C.primary, fontWeight: '700' },
  addBtn: { marginTop: 24, backgroundColor: C.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  addBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  discardBtn: { marginTop: 12, alignItems: 'center', padding: 10 },
  discardTxt: { fontSize: 13, color: C.muted },
  // history
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  sectionTotal: { fontSize: 14, fontWeight: '700', color: C.red },
  expenseCard: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  expenseCardEditing: { borderColor: C.orange, borderWidth: 2 },
  expenseMain: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expenseIcon: { fontSize: 28 },
  expenseDesc: { fontSize: 15, fontWeight: '600', color: C.text },
  expenseMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  expenseRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: C.red },
  lineItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 58, paddingVertical: 7, borderTopWidth: 1, borderColor: C.border, backgroundColor: '#FAFAF8' },
  lineItemName: { fontSize: 13, color: C.muted, flex: 1 },
  lineItemAmt: { fontSize: 13, fontWeight: '600', color: C.text },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40, fontSize: 15 },
  // category sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E8F6F0' },
  addCatText: { fontSize: 13, fontWeight: '600', color: C.primary },
  sheetRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 4 },
  sheetRowActive: { backgroundColor: '#E8F6F0' },
  sheetIcon: { fontSize: 24, marginRight: 14 },
  sheetLabel: { flex: 1, fontSize: 16, color: C.text },
  // add category modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: C.card, borderRadius: 20, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 12 },
  emojiInput: { fontSize: 28, textAlign: 'center', paddingVertical: 10 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  emojiCell: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  emojiCellActive: { backgroundColor: '#E8F6F0', borderWidth: 2, borderColor: C.primary },
  emojiCellText: { fontSize: 22 },
  confirmBtn: { marginTop: 20, backgroundColor: C.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { marginTop: 10, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.muted, fontWeight: '600', fontSize: 15 },
});
