import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Alert,
  Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addBatch, getBatches } from '../../store/production';
import DatePickerField from '../../components/DatePickerField';
import { deductStock, getStock } from '../../store/stock';
import { getWeeklyTarget, setWeeklyTarget } from '../../store/weeklyTarget';
import { ProductionBatch, StockItem } from '../../types';
import { toDateString, isThisWeek } from '../../utils/dates';
import { getFactoryId } from '../../store/context';

const C = {
  primary: '#1D9E75',
  red: '#E24B4A',
  orange: '#EF9F27',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
};

type ExtraMaterial = { stockItemId: string; name: string; unit: string; qty: string };

export default function ProductionScreen() {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(toDateString());
  const [potatoes, setPotatoes] = useState('');
  const [sachets, setSachets] = useState('');
  const [gas, setGas] = useState('');
  const [hours, setHours] = useState('');
  const [saving, setSaving] = useState(false);
  const [batches, setBatchesState] = useState<ProductionBatch[]>([]);

  const [weeklyTarget, setWeeklyTargetState] = useState(1000);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [extraMaterials, setExtraMaterials] = useState<ExtraMaterial[]>([]);
  const [showStockPicker, setShowStockPicker] = useState(false);

  // ── Draft persistence ──────────────────────────────────────────
  const draftKey = `production_draft_${getFactoryId() ?? 'default'}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.date) setDate(d.date);
        if (d.potatoes) setPotatoes(d.potatoes);
        if (d.sachets) setSachets(d.sachets);
        if (d.gas) setGas(d.gas);
        if (d.hours) setHours(d.hours);
        if (d.extraMaterials?.length) setExtraMaterials(d.extraMaterials);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ date, potatoes, sachets, gas, hours, extraMaterials }));
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, potatoes, sachets, gas, hours, extraMaterials]);

  const CORE_IDS = ['pommes_de_terre', 'gaz_lpg', 'sachets_80g'];
  const extraStockItems = stockItems.filter((s) => !CORE_IDS.includes(s.id));

  const load = useCallback(async () => {
    const [b, target, stock] = await Promise.all([
      getBatches(),
      getWeeklyTarget(),
      getStock(),
    ]);
    setBatchesState(b);
    setWeeklyTargetState(target);
    setStockItems(stock);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const potatoesNum = parseFloat(potatoes) || 0;
  const sachetsNum = parseInt(sachets) || 0;
  const gasNum = parseFloat(gas) || 0;
  const hoursNum = parseFloat(hours) || 0;
  const yieldCalc = potatoesNum > 0 ? (sachetsNum * 80) / potatoesNum : 0;

  const yieldColor = yieldCalc >= 250 ? C.primary : yieldCalc >= 200 ? C.orange : C.red;

  const weekBatches = batches.filter((b) => isThisWeek(b.date));
  const weeklyKg = weekBatches.reduce((sum, b) => sum + b.potatoesUsedKg, 0);
  const progressPct = Math.min((weeklyKg / weeklyTarget) * 100, 100);

  const addExtraMaterial = (item: StockItem) => {
    if (extraMaterials.find((m) => m.stockItemId === item.id)) {
      setShowStockPicker(false);
      return;
    }
    setExtraMaterials((prev) => [
      ...prev,
      { stockItemId: item.id, name: item.name, unit: item.unit, qty: '' },
    ]);
    setShowStockPicker(false);
  };

  const removeExtraMaterial = (id: string) => {
    setExtraMaterials((prev) => prev.filter((m) => m.stockItemId !== id));
  };

  const updateExtraQty = (id: string, qty: string) => {
    setExtraMaterials((prev) =>
      prev.map((m) => (m.stockItemId === id ? { ...m, qty } : m))
    );
  };

  const handleSaveTarget = async () => {
    const t = parseInt(targetInput) || 0;
    if (t <= 0) {
      Alert.alert('Erreur', 'L\'objectif doit être supérieur à 0.');
      return;
    }
    await setWeeklyTarget(t);
    setWeeklyTargetState(t);
    setShowTargetModal(false);
  };

  const handleSave = async () => {
    if (!potatoes || !sachets || !gas || !hours) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs principaux.');
      return;
    }
    setSaving(true);
    try {
      const extraForBatch = extraMaterials
        .filter((m) => parseFloat(m.qty) > 0)
        .map((m) => ({
          stockItemId: m.stockItemId,
          name: m.name,
          quantity: parseFloat(m.qty),
          unit: m.unit,
        }));

      const newBatch = await addBatch({
        date,
        potatoesUsedKg: potatoesNum,
        sachets80g: sachetsNum,
        gasUsedKg: gasNum,
        hoursWorked: hoursNum,
        extraMaterials: extraForBatch,
      });

      const stockDeductions: Record<string, number> = {
        pommes_de_terre: potatoesNum,
        gaz_lpg: gasNum,
        sachets_80g: sachetsNum,
      };
      for (const m of extraForBatch) {
        stockDeductions[m.stockItemId] = m.quantity;
      }
      await deductStock(stockDeductions);

      // Optimistic update — no reload spinner
      setBatchesState(prev => [newBatch, ...prev]);
      getStock().then(setStockItems);
      setPotatoes('');
      setSachets('');
      setGas('');
      setHours('');
      setExtraMaterials([]);
      setDate(toDateString());
      AsyncStorage.removeItem(draftKey);
      Alert.alert('Succès', 'Lot de production enregistré.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Enregistrer un lot</Text>

        <View style={styles.card}>
          <DatePickerField label="Date" value={date} onChange={setDate} />
          <NumField label="Matière première (kg)" value={potatoes} onChangeText={setPotatoes} />
          <NumField label="Unités produites" value={sachets} onChangeText={setSachets} />
          <NumField label="Énergie / Combustible (kg)" value={gas} onChangeText={setGas} />
          <NumField label="Heures travaillées" value={hours} onChangeText={setHours} />
        </View>

        {/* Extra materials */}
        <View style={styles.card}>
          <View style={styles.sectionRow}>
            <Text style={styles.cardTitle}>Autres matières utilisées</Text>
            {extraStockItems.length > 0 && (
              <TouchableOpacity
                style={styles.addMaterialBtn}
                onPress={() => setShowStockPicker(true)}
              >
                <Ionicons name="add" size={18} color={C.primary} />
                <Text style={styles.addMaterialText}>Ajouter</Text>
              </TouchableOpacity>
            )}
          </View>
          {extraStockItems.length === 0 && (
            <Text style={styles.noExtraHint}>
              Ajoutez d'autres articles au stock (sel, farine…) pour les suivre ici.
            </Text>
          )}
          {extraMaterials.map((m) => (
            <View key={m.stockItemId} style={styles.extraRow}>
              <Text style={styles.extraName}>{m.name}</Text>
              <TextInput
                style={styles.extraInput}
                placeholder="0"
                keyboardType="decimal-pad"
                value={m.qty}
                onChangeText={(v) => updateExtraQty(m.stockItemId, v)}
              />
              <Text style={styles.extraUnit}>{m.unit}</Text>
              <TouchableOpacity onPress={() => removeExtraMaterial(m.stockItemId)}>
                <Ionicons name="close-circle-outline" size={22} color={C.red} />
              </TouchableOpacity>
            </View>
          ))}
          {extraMaterials.length === 0 && extraStockItems.length > 0 && (
            <Text style={styles.noExtraHint}>
              Appuyez sur "Ajouter" pour enregistrer d'autres matières.
            </Text>
          )}
        </View>

        {potatoesNum > 0 && sachetsNum > 0 && (
          <View style={[styles.yieldBox, { borderColor: yieldColor + '55' }]}>
            <Text style={styles.yieldLabel}>Rendement estimé</Text>
            <Text style={[styles.yieldValue, { color: yieldColor }]}>
              {yieldCalc.toFixed(1)} g/kg
            </Text>
            <Text style={styles.yieldHint}>
              {yieldCalc >= 250 ? '✓ Bon rendement' : yieldCalc >= 200 ? '⚠ Rendement moyen' : '✗ Rendement faible'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.submitText}>
            {saving ? 'Enregistrement…' : 'Enregistrer la production'}
          </Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.cardTitle}>Production cette semaine</Text>
              <Text style={styles.progressText}>
                {weeklyKg.toFixed(0)} kg / {weeklyTarget} kg objectif
              </Text>
            </View>
            <TouchableOpacity
              style={styles.editTargetBtn}
              onPress={() => {
                setTargetInput(String(weeklyTarget));
                setShowTargetModal(true);
              }}
            >
              <Ionicons name="pencil-outline" size={16} color={C.primary} />
              <Text style={styles.editTargetText}>Objectif</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progressPct}%` as `${number}%` }]} />
          </View>
          <Text style={styles.progressPct}>{progressPct.toFixed(0)}%</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Lots récents</Text>
          {batches.slice(0, 5).map((b) => (
            <View key={b.id} style={styles.batchRow}>
              <Text style={styles.batchDate}>{b.date}</Text>
              <Text style={styles.batchInfo}>
                {b.potatoesUsedKg}kg mat. · {b.sachets80g} unités · {b.gasUsedKg}kg énergie
              </Text>
            </View>
          ))}
          {batches.length === 0 && (
            <Text style={styles.noExtraHint}>Aucun lot enregistré.</Text>
          )}
        </View>
      </ScrollView>

      {/* Weekly target modal */}
      <Modal visible={showTargetModal} animationType="slide" transparent onRequestClose={() => setShowTargetModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Objectif hebdomadaire</Text>
              <Text style={styles.fieldLabel}>Objectif hebdomadaire (kg de matière)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={targetInput}
                onChangeText={setTargetInput}
                autoFocus
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowTargetModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveTarget}>
                  <Text style={styles.confirmText}>Enregistrer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Stock picker modal */}
      <Modal visible={showStockPicker} animationType="slide" transparent onRequestClose={() => setShowStockPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choisir un article</Text>
            <FlatList
              data={extraStockItems}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => addExtraMaterial(item)}
                >
                  <Text style={styles.pickerName}>{item.name}</Text>
                  <Text style={styles.pickerUnit}>{item.currentLevel} {item.unit} en stock</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowStockPicker(false)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function NumField({
  label, value, onChangeText, keyboard = 'numeric',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboard?: 'numeric' | 'default';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboard === 'numeric' ? 'decimal-pad' : 'default'}
        placeholder="0"
        placeholderTextColor="#BABAB6"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { fontSize: 22, fontWeight: '700', color: C.text },
  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    gap: 12,
  },
  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  fieldWrap: { gap: 4 },
  fieldLabel: { fontSize: 14, color: C.muted, fontWeight: '500' },
  input: {
    backgroundColor: C.bg, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, padding: 12, fontSize: 16, color: C.text,
  },
  addMaterialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#E8F6F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  addMaterialText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  extraRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg, borderRadius: 8, padding: 10,
  },
  extraName: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  extraInput: {
    width: 70, backgroundColor: C.card, borderRadius: 8, borderWidth: 1,
    borderColor: C.border, padding: 8, fontSize: 14, color: C.text, textAlign: 'center',
  },
  extraUnit: { fontSize: 13, color: C.muted, width: 40 },
  noExtraHint: { fontSize: 13, color: C.muted, fontStyle: 'italic' },
  yieldBox: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 2,
    padding: 16, alignItems: 'center',
  },
  yieldLabel: { fontSize: 13, color: C.muted, marginBottom: 4 },
  yieldValue: { fontSize: 28, fontWeight: '700' },
  yieldHint: { fontSize: 13, color: C.muted, marginTop: 4 },
  submitBtn: {
    backgroundColor: C.primary, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  progressText: { fontSize: 13, color: C.muted },
  track: { height: 10, backgroundColor: '#F0F0EE', borderRadius: 5, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.primary, borderRadius: 5 },
  progressPct: { fontSize: 13, color: C.primary, fontWeight: '600', textAlign: 'right', marginTop: 4 },
  editTargetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#E8F6F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  editTargetText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  batchRow: { gap: 2 },
  batchDate: { fontSize: 12, color: C.muted, fontWeight: '600' },
  batchInfo: { fontSize: 13, color: C.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
    marginTop: 8,
  },
  cancelText: { fontSize: 16, color: C.muted, fontWeight: '600' },
  confirmBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 16, color: '#FFFFFF', fontWeight: '700' },
  pickerRow: {
    padding: 14, borderBottomWidth: 1, borderColor: '#F0F0EE',
  },
  pickerName: { fontSize: 15, color: C.text, fontWeight: '500' },
  pickerUnit: { fontSize: 12, color: C.muted, marginTop: 2 },
});
