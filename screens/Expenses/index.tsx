import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, FlatList, SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Expense, CustomCategory } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getExpenses, addExpense, deleteExpense, syncExpensesFromSupabase } from '../../store/expenses';
import { getCustomCategories, addCustomCategory, deleteCustomCategory } from '../../store/customCategories';
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

function catInfo(key: string, allCats: CustomCategory[]): { label: string; icon: string } {
  return allCats.find((c) => c.key === key) ?? { label: key, icon: '📦' };
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7); } // YYYY-MM

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customCats, setCustomCats] = useState<CustomCategory[]>([]);
  const [tab, setTab] = useState<'add' | 'history'>('add');

  // Form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('autre');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'orange_money'>('cash');
  const [date, setDate] = useState(toDateStr(new Date()));

  // Category picker modal
  const [catModal, setCatModal] = useState(false);

  // Add category modal
  const [addCatModal, setAddCatModal] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('');

  const allCats = [...BUILT_IN, ...customCats];

  const load = useCallback(async () => {
    syncExpensesFromSupabase();
    const [exp, cats] = await Promise.all([getExpenses(), getCustomCategories()]);
    setExpenses(exp);
    setCustomCats(cats);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAdd() {
    const amt = parseInt(amount.replace(/\s/g, ''), 10);
    if (!description.trim()) return Alert.alert('Erreur', 'Ajoutez une description.');
    if (!amt || amt <= 0) return Alert.alert('Erreur', 'Montant invalide.');
    await addExpense({ date, category, description: description.trim(), amount: amt, paymentMethod });
    setDescription(''); setAmount(''); setCategory('autre');
    setPaymentMethod('cash'); setDate(toDateStr(new Date()));
    const data = await getExpenses();
    setExpenses(data);
    Alert.alert('Dépense ajoutée', `${formatGNF(amt)} enregistré.`);
  }

  async function handleDelete(id: string) {
    Alert.alert('Supprimer ?', 'Cette dépense sera définitivement supprimée.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          await deleteExpense(id);
          setExpenses((prev) => prev.filter((e) => e.id !== id));
        },
      },
    ]);
  }

  async function handleAddCategory() {
    if (!newCatLabel.trim()) return Alert.alert('Erreur', 'Entrez un nom de catégorie.');
    const cat = await addCustomCategory(newCatLabel, newCatEmoji || '📦');
    setCustomCats((prev) => [...prev, cat]);
    setCategory(cat.key);
    setNewCatLabel(''); setNewCatEmoji('');
    setAddCatModal(false);
    setCatModal(false);
  }

  async function handleDeleteCat(key: string) {
    await deleteCustomCategory(key);
    setCustomCats((prev) => prev.filter((c) => c.key !== key));
    if (category === key) setCategory('autre');
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthTotal = expenses.filter((e) => e.date >= monthStart).reduce((sum, e) => sum + e.amount, 0);

  // Group history by month
  const grouped: { [ym: string]: Expense[] } = {};
  for (const e of expenses) {
    const k = monthKey(e.date);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const sections = Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .map((ym) => ({
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
          <Text style={[styles.tabText, tab === 'add' && styles.tabTextActive]}>Ajouter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'history' && styles.tabActive]} onPress={() => setTab('history')}>
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>
            Historique ({expenses.length})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'add' ? (
        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.label}>Catégorie</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setCatModal(true)}>
            <Text style={styles.pickerText}>{catIcon}  {catLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={C.muted} />
          </TouchableOpacity>

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Achat huile, électricité..."
            placeholderTextColor={C.muted}
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.label}>Montant (GNF)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 50000"
            placeholderTextColor={C.muted}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />

          <DatePickerField label="Date" value={date} onChange={setDate} />

          <Text style={styles.label}>Mode de paiement</Text>
          <View style={styles.row}>
            {(['cash', 'orange_money'] as const).map((m) => (
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

          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
            <Text style={styles.addBtnText}>Enregistrer la dépense</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
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
            return (
              <View style={styles.expenseCard}>
                <View style={styles.expenseLeft}>
                  <Text style={styles.expenseIcon}>{info.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expenseDesc}>{item.description || info.label}</Text>
                    <Text style={styles.expenseMeta}>{info.label} · {item.date}</Text>
                  </View>
                </View>
                <View style={styles.expenseRight}>
                  <Text style={styles.expenseAmount}>{formatGNF(item.amount)}</Text>
                  <TouchableOpacity onPress={() => handleDelete(item.id)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={18} color={C.red} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      {/* Category picker */}
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
            {allCats.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.sheetRow, category === c.key && styles.sheetRowActive]}
                onPress={() => { setCategory(c.key); setCatModal(false); }}
              >
                <Text style={styles.sheetIcon}>{c.icon}</Text>
                <Text style={styles.sheetLabel}>{c.label}</Text>
                {category === c.key && <Ionicons name="checkmark" size={18} color={C.primary} />}
                {!BUILT_IN.find((b) => b.key === c.key) && (
                  <TouchableOpacity onPress={() => handleDeleteCat(c.key)} style={{ padding: 4, marginLeft: 4 }}>
                    <Ionicons name="trash-outline" size={16} color={C.red} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Add custom category */}
      <Modal visible={addCatModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Nouvelle catégorie</Text>

            <Text style={styles.fieldLabel}>Nom</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Marketing, Eau..."
              placeholderTextColor={C.muted}
              value={newCatLabel}
              onChangeText={setNewCatLabel}
            />

            <Text style={styles.fieldLabel}>Emoji</Text>
            <TextInput
              style={[styles.input, styles.emojiInput]}
              placeholder="🏷️"
              value={newCatEmoji}
              onChangeText={(v) => setNewCatEmoji(v.slice(-2))}
              maxLength={2}
            />
            <View style={styles.emojiGrid}>
              {EMOJI_GRID.map((e) => (
                <TouchableOpacity
                  key={e}
                  style={[styles.emojiCell, newCatEmoji === e && styles.emojiCellActive]}
                  onPress={() => setNewCatEmoji(e)}
                >
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
  input: { backgroundColor: C.card, borderRadius: 12, padding: 14, fontSize: 16, color: C.text, borderWidth: 1, borderColor: C.border },
  picker: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 16, color: C.text },
  row: { flexDirection: 'row', gap: 10 },
  methodBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center' },
  methodBtnActive: { borderColor: C.primary, backgroundColor: '#E8F6F0' },
  methodText: { fontSize: 14, color: C.muted, fontWeight: '500' },
  methodTextActive: { color: C.primary, fontWeight: '700' },
  addBtn: { marginTop: 24, backgroundColor: C.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  addBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  // history
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  sectionTotal: { fontSize: 14, fontWeight: '700', color: C.red },
  expenseCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expenseLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  expenseIcon: { fontSize: 28 },
  expenseDesc: { fontSize: 15, fontWeight: '600', color: C.text },
  expenseMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  expenseRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: C.red },
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
