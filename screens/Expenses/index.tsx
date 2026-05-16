import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Expense, ExpenseCategory } from '../../types';
import DatePickerField from '../../components/DatePickerField';
import { getExpenses, addExpense, deleteExpense, syncExpensesFromSupabase } from '../../store/expenses';
import { formatGNF } from '../../utils/format';

const C = {
  primary: '#1D9E75', red: '#E24B4A', orange: '#EF9F27',
  bg: '#F8F8F6', card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

const CATEGORIES: { key: ExpenseCategory; label: string; icon: string }[] = [
  { key: 'loyer', label: 'Loyer', icon: '🏠' },
  { key: 'salaire', label: 'Salaire', icon: '👷' },
  { key: 'matiere_premiere', label: 'Matières premières', icon: '🥔' },
  { key: 'energie', label: 'Énergie / Gaz', icon: '⚡' },
  { key: 'transport', label: 'Transport', icon: '🚚' },
  { key: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { key: 'autre', label: 'Autre', icon: '📦' },
];

function catLabel(key: ExpenseCategory) {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
function catIcon(key: ExpenseCategory) {
  return CATEGORIES.find((c) => c.key === key)?.icon ?? '📦';
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tab, setTab] = useState<'add' | 'history'>('add');
  const [modalVisible, setModalVisible] = useState(false);

  // Form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('autre');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'orange_money'>('cash');
  const [date, setDate] = useState(toDateStr(new Date()));

  const load = useCallback(async () => {
    syncExpensesFromSupabase();
    const data = await getExpenses();
    setExpenses(data);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAdd() {
    const amt = parseInt(amount.replace(/\s/g, ''), 10);
    if (!description.trim()) return Alert.alert('Erreur', 'Ajoutez une description.');
    if (!amt || amt <= 0) return Alert.alert('Erreur', 'Montant invalide.');
    await addExpense({ date, category, description: description.trim(), amount: amt, paymentMethod });
    setDescription('');
    setAmount('');
    setCategory('autre');
    setPaymentMethod('cash');
    setDate(toDateStr(new Date()));
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

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthExpenses = expenses.filter((e) => e.date >= monthStart);
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

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
          <TouchableOpacity style={styles.picker} onPress={() => setModalVisible(true)}>
            <Text style={styles.pickerText}>
              {catIcon(category)}  {catLabel(category)}
            </Text>
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
        <FlatList
          data={expenses}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée</Text>}
          renderItem={({ item }) => (
            <View style={styles.expenseCard}>
              <View style={styles.expenseLeft}>
                <Text style={styles.expenseIcon}>{catIcon(item.category)}</Text>
                <View>
                  <Text style={styles.expenseDesc}>{item.description || catLabel(item.category)}</Text>
                  <Text style={styles.expenseMeta}>{catLabel(item.category)} · {item.date}</Text>
                </View>
              </View>
              <View style={styles.expenseRight}>
                <Text style={styles.expenseAmount}>{formatGNF(item.amount)}</Text>
                <TouchableOpacity onPress={() => handleDelete(item.id)} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={18} color={C.red} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setModalVisible(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Catégorie</Text>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.sheetRow, category === c.key && styles.sheetRowActive]}
              onPress={() => { setCategory(c.key); setModalVisible(false); }}
            >
              <Text style={styles.sheetIcon}>{c.icon}</Text>
              <Text style={styles.sheetLabel}>{c.label}</Text>
              {category === c.key && <Ionicons name="checkmark" size={18} color={C.primary} />}
            </TouchableOpacity>
          ))}
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
  expenseCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expenseLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  expenseIcon: { fontSize: 28 },
  expenseDesc: { fontSize: 15, fontWeight: '600', color: C.text },
  expenseMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  expenseRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: C.red },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40, fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 16 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 4 },
  sheetRowActive: { backgroundColor: '#E8F6F0' },
  sheetIcon: { fontSize: 24, marginRight: 14 },
  sheetLabel: { flex: 1, fontSize: 16, color: C.text },
});
