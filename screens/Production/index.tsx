import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Animated, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getFlavors, updateFlavor, syncFlavorsFromSupabase } from '../../store/flavors';
import { getBulks, updateBulk, syncBulksFromSupabase } from '../../store/bulks';
import { getBatches, addBatch, syncBatchesFromSupabase } from '../../store/batches';
import { getStock, deductStock, recordStockAddition, addStockItem, checkStockAvailability, syncStockFromSupabase } from '../../store/stock';
import DatePickerField from '../../components/DatePickerField';
import { toDateString } from '../../utils/dates';
import { hapticSuccess } from '../../utils/haptics';
import { ProductFlavor, BulkProduct, RecipeLine, Batch, StockItem } from '../../types';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, Text } from '../../components/ui';

type ScreenState = 'list' | 'log';
type MaterialRow = { rawMaterialId: string; name: string; quantity: string; unit: string };

// What Production actually produces INTO — a Saveur or a standalone Lot
// (one with no flavorId; a lot built on a flavor has no stock of its own,
// see store/bulks.ts, so it isn't a producible target itself — only its
// underlying flavor is). This is deliberately the same real inventory item
// Ventes sells, not a separate "production product" — see CLAUDE.md
// "Production — produces directly into Saveurs/Lots" for the bug this
// closes: the two used to be disconnected catalogs, so producing something
// never actually made it sellable.
type ProducibleItem = {
  id: string;
  name: string;
  unit: string;
  kind: 'flavor' | 'bulk';
  recipePerUnit: RecipeLine[];
};

export default function ProductionScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();

  // ── Data ──────────────────────────────────────────────────────────
  const [flavors, setFlavorsState] = useState<ProductFlavor[]>([]);
  const [bulks, setBulksState] = useState<BulkProduct[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  const producibleItems: ProducibleItem[] = [
    ...flavors.map((f): ProducibleItem => ({ id: f.id, name: f.label, unit: 'sachet', kind: 'flavor', recipePerUnit: f.recipePerUnit })),
    ...bulks.filter((b) => !b.flavorId).map((b): ProducibleItem => ({ id: b.id, name: b.name, unit: 'unité', kind: 'bulk', recipePerUnit: b.recipePerUnit })),
  ];

  // A finished, sellable product is never a raw material — every flavor and
  // every lot (even a flavor-linked one, which shares its parent flavor's
  // stock) is excluded from the "Ajouter une matière" picker below. Without
  // this, that picker showed every row in the shared stock table
  // undifferentiated, the exact same "everything in one pool" bug already
  // fixed on the Stock screen — just reached from a different screen.
  const finishedGoodsIds = new Set<string>([...flavors.map((f) => f.id), ...bulks.map((b) => b.id)]);

  // ── Screen state ──────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>('list');
  const [selectedItem, setSelectedItem] = useState<ProducibleItem | null>(null);

  // ── Batch log form ────────────────────────────────────────────────
  const [units, setUnits] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [logDate, setLogDate] = useState(toDateString());
  const [energy, setEnergy] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Modals ────────────────────────────────────────────────────────
  const [todayModal, setTodayModal] = useState(false);

  // One modal for the "•••" flow (actions menu → history OR recette),
  // swapping an internal view — never three separate <AppModal>s toggled
  // in the same tick. That used to be exactly the shape here (a dedicated
  // productActionsModal/batchHistoryModal/formulaModal, each its own
  // AppModal), and AppModal always mounts a real native RNModal for as
  // long as its own close animation is still running — closing one and
  // opening another in the same handler briefly left two native modals
  // stacked, which is what "tap Voir l'historique, then the whole screen
  // stops responding to taps" actually was: not a data bug, a modal-stacking
  // race. Mirrors the materialModalView pattern already used below.
  const [actionsItem, setActionsItem] = useState<ProducibleItem | null>(null);
  const [productModalView, setProductModalView] = useState<'none' | 'actions' | 'history' | 'recette'>('none');
  const [formulaMaterials, setFormulaMaterials] = useState<MaterialRow[]>([]);
  const [savingFormula, setSavingFormula] = useState(false);

  // One modal for "add a material," swapping between picking an existing
  // stock item and creating a new one — never two Modals stacked. Shared by
  // the batch log and the formula editor; materialTarget says which of the
  // two lists a picked/created material actually gets appended to.
  const [materialModalView, setMaterialModalView] = useState<'none' | 'pick' | 'new'>('none');
  const [materialTarget, setMaterialTarget] = useState<'batch' | 'formula'>('batch');
  const [newMatName, setNewMatName] = useState('');
  const [newMatUnit, setNewMatUnit] = useState('');
  // Captured in the same step as creating the material itself — see
  // handleCreateMaterial's own comment for the confusion this closes: a
  // brand-new factory with nothing in Stock yet has no other field on
  // screen to type a quantity into, so a rushed user typed their intended
  // amount into "Nom" instead, creating a bogus raw material literally
  // named "20".
  const [newMatQty, setNewMatQty] = useState('');

  // ── Toast ─────────────────────────────────────────────────────────
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [toastText, setToastText] = useState('');

  const showToast = (text: string) => {
    setToastText(text);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // ── Load ──────────────────────────────────────────────────────────
  // Cache-first: this used to read cache only, with nothing to actually
  // refresh it — a device landing here without having visited Ventes/Stock
  // first (which happen to sync these same stores) could sit on stale data
  // indefinitely. Now reads cache instantly for a fast render, then syncs
  // in the background and re-renders once fresh data lands — same shape
  // used everywhere else this pass (see Ventes/index.tsx).
  const load = useCallback(async () => {
    const [fl, bk, b, s] = await Promise.all([
      getFlavors(), getBulks(), getBatches(), getStock(),
    ]);
    setFlavorsState(fl);
    setBulksState(bk);
    setBatches(b);
    setStockItems(s);

    await Promise.all([
      syncFlavorsFromSupabase(), syncBulksFromSupabase(), syncBatchesFromSupabase(), syncStockFromSupabase(),
    ]);
    const [freshFl, freshBk, freshB, freshS] = await Promise.all([
      getFlavors(), getBulks(), getBatches(), getStock(),
    ]);
    setFlavorsState(freshFl);
    setBulksState(freshBk);
    setBatches(freshB);
    setStockItems(freshS);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Derived data ──────────────────────────────────────────────────
  const todayStr = toDateString();
  const todayBatches = batches.filter((b) => b.date === todayStr);
  const todayUnits = todayBatches.reduce((sum, b) => sum + b.unitsProduced, 0);

  const lastBatchDate: Record<string, string> = {};
  for (const b of batches) {
    if (!lastBatchDate[b.productId] || b.date > lastBatchDate[b.productId]) {
      lastBatchDate[b.productId] = b.date;
    }
  }

  // ── Stock status for current materials ────────────────────────────
  const missingItems = materials
    .filter((m) => m.rawMaterialId && parseFloat(m.quantity) > 0)
    .filter((m) => {
      const s = stockItems.find((si) => si.id === m.rawMaterialId);
      return s !== undefined && s.currentLevel < parseFloat(m.quantity);
    })
    .map((m) => {
      const s = stockItems.find((si) => si.id === m.rawMaterialId);
      const deficit = parseFloat(m.quantity) - (s?.currentLevel ?? 0);
      return `${m.name} (${deficit.toFixed(1)}${m.unit})`;
    });
  const stockOk = missingItems.length === 0;
  const hasMaterialsWithQty = materials.some((m) => parseFloat(m.quantity) > 0);

  // ── Select item → go to log state ─────────────────────────────
  const selectItem = (item: ProducibleItem) => {
    setSelectedItem(item);
    setUnits('');
    setLogDate(toDateString());
    setEnergy('');
    setHours('');
    setNotes('');
    setDetailsOpen(false);
    // Blank quantities to start — the formula effect below fills them in the
    // instant a real "Combien ?" value is typed, scaled from recipePerUnit.
    // Starting from the stored per-unit numbers themselves (as the old
    // lastRecipe flow did) would show a tiny, wrong quantity before any
    // scaling happens.
    setMaterials(
      item.recipePerUnit.map((r) => ({
        rawMaterialId: r.rawMaterialId,
        name: r.name,
        quantity: '',
        unit: r.unit,
      }))
    );
    setScreenState('log');
  };

  // Rounds a scaled quantity to 2 decimals — enough precision for any
  // realistic unit (kg, L, g) without floating-point noise like
  // "12.600000000000001" showing up in the field.
  const roundTo2 = (n: number): number => Math.round(n * 100) / 100;

  // Auto-scale: whenever "Combien ?" changes, every material row that's
  // actually part of this item's stored formula recomputes from it (formula
  // qty × units). A material added ad hoc for this one batch (via "Ajouter
  // une matière", not present in recipePerUnit) is left alone — it has no
  // ratio to scale from, and isn't meant to be part of the formula.
  useEffect(() => {
    if (!selectedItem || selectedItem.recipePerUnit.length === 0) return;
    const unitsNum = parseFloat(units) || 0;
    setMaterials((prev) => prev.map((m) => {
      const formulaRow = selectedItem.recipePerUnit.find((r) => r.rawMaterialId === m.rawMaterialId);
      if (!formulaRow) return m;
      return { ...m, quantity: unitsNum > 0 ? String(roundTo2(formulaRow.quantity * unitsNum)) : '' };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  const backToList = () => {
    setScreenState('list');
    setSelectedItem(null);
  };

  // Persists a formula to whichever real catalog the item actually belongs
  // to — a flavor and a standalone lot are different tables under the hood,
  // but from here on they're both just "a producible item" with a formula.
  const saveRecipeFor = async (item: ProducibleItem, recipe: RecipeLine[]) => {
    if (item.kind === 'flavor') {
      await updateFlavor(item.id, { recipePerUnit: recipe });
    } else {
      await updateBulk(item.id, { recipePerUnit: recipe });
    }
  };

  // ── Material helpers ──────────────────────────────────────────────
  // Shared by the batch log and the formula editor — materialTarget says
  // which list a picked/created material actually lands in.
  const addMaterialFromStock = (item: StockItem) => {
    const list = materialTarget === 'formula' ? formulaMaterials : materials;
    const setList = materialTarget === 'formula' ? setFormulaMaterials : setMaterials;
    if (!list.find((m) => m.rawMaterialId === item.id)) {
      setList((prev) => [
        ...prev,
        { rawMaterialId: item.id, name: item.name, quantity: '', unit: item.unit },
      ]);
    }
    setMaterialModalView('none');
  };

  const removeMaterial = (idx: number) => {
    setMaterials((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMaterialQty = (idx: number, qty: string) => {
    setMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, quantity: qty } : m)));
  };

  const updateFormulaQty = (idx: number, qty: string) => {
    setFormulaMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, quantity: qty } : m)));
  };

  const removeFormulaMaterial = (idx: number) => {
    setFormulaMaterials((prev) => prev.filter((_, i) => i !== idx));
  };

  const openFormula = (item: ProducibleItem) => {
    setFormulaMaterials(
      item.recipePerUnit.map((r) => ({ rawMaterialId: r.rawMaterialId, name: r.name, quantity: String(r.quantity), unit: r.unit }))
    );
    setProductModalView('recette');
  };

  const handleSaveFormula = async () => {
    if (!actionsItem) return;
    setSavingFormula(true);
    try {
      const recipe = formulaMaterials
        .filter((m) => m.rawMaterialId && parseFloat(m.quantity) > 0)
        .map((m) => ({ rawMaterialId: m.rawMaterialId, name: m.name, quantity: parseFloat(m.quantity) || 0, unit: m.unit }));
      await saveRecipeFor(actionsItem, recipe);
      setProductModalView('none');
      await load();
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'enregistrer la recette. ${e?.message ?? ''}`.trim());
    } finally {
      setSavingFormula(false);
    }
  };

  // ── Save batch ────────────────────────────────────────────────────
  const handleSave = async () => {
    const unitsNum = parseFloat(units);
    if (!units || isNaN(unitsNum) || unitsNum <= 0) {
      Alert.alert('Erreur', 'Entrez la quantité produite.');
      return;
    }
    if (materials.length === 0) {
      Alert.alert('Erreur', 'Ajoutez au moins une matière première.');
      return;
    }

    const deductions: Record<string, number> = {};
    for (const m of materials) {
      const qty = parseFloat(m.quantity) || 0;
      if (m.rawMaterialId && qty > 0) {
        deductions[m.rawMaterialId] = (deductions[m.rawMaterialId] ?? 0) + qty;
      }
    }
    const shortfalls = await checkStockAvailability(deductions);
    if (shortfalls.length > 0) {
      const detail = shortfalls
        .map((s) => `${s.name} : ${s.available} ${s.unit} dispo, ${s.needed} ${s.unit} nécessaire${s.needed > 1 ? 's' : ''}`)
        .join('\n');
      Alert.alert(
        'Stock insuffisant',
        `${detail}\n\nEnregistrer quand même ? Le stock manquant sera ramené à 0.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Enregistrer quand même', style: 'destructive', onPress: doSave },
        ]
      );
      return;
    }

    await doSave();
  };

  const doSave = async () => {
    const unitsNum = parseFloat(units);
    setSaving(true);
    try {
      const validMaterials = materials.map((m) => ({
        rawMaterialId: m.rawMaterialId,
        name: m.name,
        quantity: parseFloat(m.quantity) || 0,
        unit: m.unit,
      }));

      await addBatch({
        date: logDate,
        productId: selectedItem!.id,
        productName: selectedItem!.name,
        unitsProduced: unitsNum,
        materialsUsed: validMaterials,
        energyUsed: energy ? parseFloat(energy) : undefined,
        hoursWorked: hours ? parseFloat(hours) : undefined,
        notes: notes || undefined,
      });

      // Establish the formula automatically from this item's very first
      // real batch — zero separate setup step needed. Once a formula
      // exists, a routine batch save never touches it again: a one-off
      // adjustment during real production (running short on an ingredient,
      // a rounding tweak) must never silently corrupt the master formula.
      // Deliberate edits go through "Modifier la formule" instead.
      if (selectedItem!.recipePerUnit.length === 0 && unitsNum > 0) {
        const derivedRecipe = validMaterials
          .filter((m) => m.rawMaterialId && m.quantity > 0)
          .map((m) => ({ ...m, quantity: roundTo2(m.quantity / unitsNum) }));
        await saveRecipeFor(selectedItem!, derivedRecipe);
      }

      // Deduct raw materials from stock
      const deductions: Record<string, number> = {};
      for (const m of validMaterials) {
        if (m.rawMaterialId && m.quantity > 0) {
          deductions[m.rawMaterialId] = (deductions[m.rawMaterialId] ?? 0) + m.quantity;
        }
      }
      await deductStock(deductions);

      // Cost of what this batch actually produced = the GNF cost of the
      // materials it consumed, each at that material's current
      // weighted-average cost. This is what lets the finished-goods item's
      // own avgCost — and eventually a sale's cost_amount — reflect a real
      // number instead of nothing.
      const totalMaterialCost = validMaterials.reduce((sum, m) => {
        const material = stockItems.find((s) => s.id === m.rawMaterialId);
        return sum + m.quantity * (material?.avgCost ?? 0);
      }, 0);
      const unitCost = unitsNum > 0 ? totalMaterialCost / unitsNum : 0;

      // Increment the SAME finished-goods stock item Ventes sells against —
      // selectedItem.id is a real flavor/bulk id, not a separate production
      // product id, which is the whole point of this rewrite.
      await recordStockAddition(selectedItem!.id, unitsNum, unitCost);

      await load();
      backToList();
      hapticSuccess();
      showToast('✅ Lot enregistré');
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'enregistrer le lot. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  };

  // ── Create new raw material inline ────────────────────────────────
  // Creates a permanent stock item (Nom + Unité) AND, in the same step,
  // seeds the quantity row it's being added for — batch or formula,
  // whichever materialTarget says. Quantity used to be left blank here,
  // which is what caused the reported bug: with Stock empty, "Ajouter une
  // matière" → "Aucun article en stock" → "+ Nouvelle matière première" is
  // the ONLY path forward, and its two fields (Nom/Unité) were the only
  // thing on screen — so a user trying to record "I used 20" typed 20 into
  // Nom itself, creating a real raw material named "20". Asking for the
  // quantity right here, where the user already expects to type it, closes
  // that gap without changing the picker flow at all.
  const handleCreateMaterial = async () => {
    if (!newMatName.trim() || !newMatUnit.trim()) return;
    const item = await addStockItem({
      name: newMatName.trim(),
      unit: newMatUnit.trim(),
      currentLevel: 0,
      alertThreshold: 0,
    });
    const setList = materialTarget === 'formula' ? setFormulaMaterials : setMaterials;
    setList((prev) => [
      ...prev,
      { rawMaterialId: item.id, name: item.name, quantity: newMatQty.trim(), unit: item.unit },
    ]);
    setNewMatName('');
    setNewMatUnit('');
    setNewMatQty('');
    setMaterialModalView('none');
    // reload stock so picker shows the new item next time
    getStock().then(setStockItems);
  };

  // ── Render: STATE 1 — item list ────────────────────────────────
  const renderList = () => (
    <ScrollView style={styles.fill} contentContainerStyle={styles.listContent}>
      {/* Today's batches card */}
      <TouchableOpacity style={styles.todayCard} onPress={() => setTodayModal(true)} activeOpacity={0.7}>
        <View>
          <Text style={styles.todayTitle}>Aujourd'hui</Text>
          <Text style={styles.todayStats}>
            {todayBatches.length} lot{todayBatches.length !== 1 ? 's' : ''} · {todayUnits} unités produites
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.muted} />
      </TouchableOpacity>

      {/* Item list — every Saveur and standalone Lot, the same items sold
          in Ventes. New ones are created there (Menu > Saveurs / Vrac),
          not here — Production only produces into what already exists. */}
      {producibleItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Créez une saveur ou un lot dans Menu pour commencer à produire.</Text>
        </View>
      ) : (
        <View style={styles.productList}>
          {producibleItems.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 && <View style={styles.rowDivider} />}
              <View style={styles.productCard}>
                <TouchableOpacity
                  style={styles.productCardMain}
                  onPress={() => selectItem(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{item.name}</Text>
                    <Text style={styles.productUnit}>{item.unit}</Text>
                  </View>
                  <Text style={lastBatchDate[item.id] ? styles.productLastMade : styles.productNeverMade}>
                    {lastBatchDate[item.id] ? `Dernière fois: ${lastBatchDate[item.id]}` : 'Jamais produit'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.productMenuBtn}
                  onPress={() => { setActionsItem(item); setProductModalView('actions'); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="ellipsis-vertical" size={20} color={palette.muted} />
                </TouchableOpacity>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}
    </ScrollView>
  );

  // ── Render: STATE 2 — batch log form ─────────────────────────────
  const renderLog = () => (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.logContent}>
        {/* Back header */}
        <TouchableOpacity style={styles.backBtn} onPress={backToList}>
          <Ionicons name="arrow-back" size={22} color={palette.moss} />
          <Text style={styles.backBtnText}>{selectedItem?.name}</Text>
        </TouchableOpacity>

        {/* Combien? */}
        <View style={styles.card}>
          <Text style={styles.bigFieldLabel}>Combien ?</Text>
          <View style={styles.unitsRow}>
            <TextInput
              style={styles.unitsInput}
              value={units}
              onChangeText={setUnits}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={palette.muted}
              autoFocus
            />
            <Text style={styles.unitsLabel} numberOfLines={2}>{selectedItem?.unit}</Text>
          </View>
        </View>

        {/* Matières utilisées */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Matières utilisées</Text>
          <Text style={styles.formulaHint}>
            {selectedItem && selectedItem.recipePerUnit.length > 0
              ? 'Calculé automatiquement à partir de la recette'
              : 'Ce premier lot enregistrera la recette pour la prochaine fois'}
          </Text>
          {materials.map((m, idx) => (
            <View key={idx} style={styles.matRow}>
              <Text style={styles.matName}>{m.name}</Text>
              <TextInput
                style={styles.matQtyInput}
                value={m.quantity}
                onChangeText={(v) => updateMaterialQty(idx, v)}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={palette.muted}
              />
              <Text style={styles.matUnit}>{m.unit}</Text>
              <TouchableOpacity onPress={() => removeMaterial(idx)}>
                <Ionicons name="close-circle-outline" size={22} color={palette.critical} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addMatBtn} onPress={() => { setMaterialTarget('batch'); setMaterialModalView('pick'); }}>
            <Ionicons name="add" size={18} color={palette.moss} />
            <Text style={styles.addMatBtnText}>Ajouter une matière</Text>
          </TouchableOpacity>
        </View>

        {/* Stock status */}
        {hasMaterialsWithQty && (
          <View style={[
            styles.stockStatus,
            { borderColor: stockOk ? palette.moss + '44' : palette.caution + '66' },
          ]}>
            {stockOk ? (
              <View style={styles.stockStatusRow}>
                <Ionicons name="checkmark-circle" size={16} color={palette.moss} />
                <Text style={[styles.stockStatusText, { color: palette.moss }]}>
                  Tu as tout en stock
                </Text>
              </View>
            ) : (
              <View style={styles.stockStatusRow}>
                <Ionicons name="alert-circle" size={16} color={palette.caution} />
                <Text style={[styles.stockStatusText, { color: palette.caution }]}>
                  Il te manque: {missingItems.join(', ')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Plus de détails */}
        <TouchableOpacity style={styles.detailsToggle} onPress={() => setDetailsOpen(!detailsOpen)}>
          <Text style={styles.detailsToggleText}>Plus de détails</Text>
          <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={palette.muted} />
        </TouchableOpacity>

        {detailsOpen && (
          <View style={styles.card}>
            <DatePickerField label="Date" value={logDate} onChange={setLogDate} />
            <FieldWrap label="Énergie / Combustible (kg)">
              <TextInput
                style={styles.input}
                value={energy}
                onChangeText={setEnergy}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={palette.muted}
              />
            </FieldWrap>
            <FieldWrap label="Heures travaillées">
              <TextInput
                style={styles.input}
                value={hours}
                onChangeText={setHours}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={palette.muted}
              />
            </FieldWrap>
            <FieldWrap label="Notes">
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Notes optionnelles…"
                placeholderTextColor={palette.muted}
              />
            </FieldWrap>
          </View>
        )}

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Main render ───────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.pageTitle}>Production</Text>

      {screenState === 'list' ? renderList() : renderLog()}

      {/* Toast */}
      <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
        <Text style={styles.toastText}>{toastText}</Text>
      </Animated.View>

      {/* ── TODAY'S BATCHES ── */}
      <AppModal visible={todayModal} onClose={() => setTodayModal(false)} title="Lots d'aujourd'hui">
        {todayBatches.length === 0 ? (
          <Text style={styles.emptyText}>Aucun lot enregistré aujourd'hui.</Text>
        ) : (
          <ScrollView style={styles.historyScroll}>
            <View style={styles.historyList}>
              {todayBatches.map((item, i) => {
                const prod = producibleItems.find((p) => p.id === item.productId);
                return (
                  <React.Fragment key={item.id}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <View style={styles.historyRow}>
                      <Text style={styles.historyProduct}>{item.productName}</Text>
                      <Text style={styles.historyUnits}>{item.unitsProduced} {prod?.unit ?? ''}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          </ScrollView>
        )}
      </AppModal>

      {/* ── ITEM ACTIONS (overflow menu) — one AppModal for the whole
          actions→historique/recette flow, swapping an internal view
          instead of three separate <AppModal>s (see productModalView's
          own comment above for the stacked-modal bug this replaced).
          Renaming/deleting a Saveur or Lot happens on its own screen
          (Menu > Saveurs / Vrac), which already has that flow — not here. */}
      <AppModal
        visible={productModalView !== 'none'}
        onClose={() => setProductModalView('none')}
        showCloseButton={productModalView !== 'actions'}
        title={
          productModalView === 'recette' ? `Recette — ${actionsItem?.name ?? ''}` :
          productModalView === 'history' ? actionsItem?.name :
          undefined
        }
      >
        {productModalView === 'actions' && (() => {
          const hasHistory = batches.some((b) => b.productId === actionsItem?.id);
          return (
            <>
              <Text style={styles.modalTitle}>{actionsItem?.name}</Text>
              {/* Nothing to show for an item that's never been produced —
                  offering "Voir l'historique" with nothing behind it was
                  the reported bug: it opened onto an empty list every
                  time, since every item here starts as "Jamais produit". */}
              {hasHistory && (
                <ActionRow
                  icon="time-outline"
                  label="Voir l'historique"
                  onPress={() => setProductModalView('history')}
                />
              )}
              <ActionRow
                icon="calculator-outline"
                label="Modifier la recette"
                last
                onPress={() => {
                  if (actionsItem) openFormula(actionsItem);
                }}
              />
            </>
          );
        })()}

        {productModalView === 'recette' && (
          <>
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.formulaHint}>
                Quantité de chaque matière nécessaire pour produire 1 {actionsItem?.unit}
              </Text>
              {formulaMaterials.map((m, idx) => (
                <View key={idx} style={styles.matRow}>
                  <Text style={styles.matName}>{m.name}</Text>
                  <TextInput
                    style={styles.matQtyInput}
                    value={m.quantity}
                    onChangeText={(v) => updateFormulaQty(idx, v)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={palette.muted}
                  />
                  <Text style={styles.matUnit}>{m.unit}</Text>
                  <TouchableOpacity onPress={() => removeFormulaMaterial(idx)}>
                    <Ionicons name="close-circle-outline" size={22} color={palette.critical} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addMatBtn} onPress={() => { setMaterialTarget('formula'); setMaterialModalView('pick'); }}>
                <Ionicons name="add" size={18} color={palette.moss} />
                <Text style={styles.addMatBtnText}>Ajouter une matière</Text>
              </TouchableOpacity>
              <View style={styles.modalActions}>
                <Button label="Annuler" variant="ghost" onPress={() => setProductModalView('none')} style={{ flex: 1 }} />
                <Button label="Enregistrer" onPress={handleSaveFormula} loading={savingFormula} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </>
        )}

        {productModalView === 'history' && (() => {
          const historyBatches = batches.filter((b) => b.productId === actionsItem?.id);
          return historyBatches.length === 0 ? (
            <Text style={styles.emptyText}>Aucun lot enregistré.</Text>
          ) : (
            <ScrollView style={styles.historyScroll}>
              <View style={styles.historyList}>
                {historyBatches.map((item, i) => (
                  <React.Fragment key={item.id}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <View style={styles.historyRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyDate}>{item.date}</Text>
                        <Text style={styles.historyMats} numberOfLines={2}>
                          {item.materialsUsed.map((m) => `${m.quantity}${m.unit} ${m.name}`).join(' · ')}
                        </Text>
                      </View>
                      <Text style={styles.historyUnits}>{item.unitsProduced} {actionsItem?.unit}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </ScrollView>
          );
        })()}
      </AppModal>

      {/* ── ADD A MATERIAL — pick existing or create new, one modal ── */}
      <AppModal
        visible={materialModalView !== 'none'}
        onClose={() => setMaterialModalView('none')}
        title={materialModalView === 'new' ? 'Nouvelle matière première' : 'Ajouter une matière'}
      >
        {materialModalView === 'new' && (
          <TouchableOpacity onPress={() => setMaterialModalView('pick')} style={styles.backLink} hitSlop={8}>
            <Ionicons name="chevron-back" size={16} color={palette.moss} />
            <Text style={styles.backLinkText}>Retour</Text>
          </TouchableOpacity>
        )}
        {materialModalView === 'pick' ? (
          <>
            {/* Raw materials only — a Saveur or Lot is never offered as an
                ingredient of another product, itself included. */}
            {stockItems.filter((s) => !finishedGoodsIds.has(s.id)).length === 0 ? (
              <Text style={styles.emptyText}>Aucune matière première dans votre stock pour l'instant. Créez-en une ci-dessous.</Text>
            ) : (
              <ScrollView style={styles.historyScroll}>
                <View style={styles.historyList}>
                  {stockItems.filter((s) => !finishedGoodsIds.has(s.id)).map((item, i) => (
                    <React.Fragment key={item.id}>
                      {i > 0 && <View style={styles.rowDivider} />}
                      <TouchableOpacity style={styles.pickerRow} onPress={() => addMaterialFromStock(item)}>
                        <Text style={styles.pickerName}>{item.name}</Text>
                        <Text style={styles.pickerLevel}>{item.currentLevel} {item.unit} en stock</Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  ))}
                </View>
              </ScrollView>
            )}
            <TouchableOpacity style={styles.addMatBtn} onPress={() => setMaterialModalView('new')}>
              <Ionicons name="add" size={18} color={palette.moss} />
              <Text style={styles.addMatBtnText}>Nouvelle matière première</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.formulaHint}>
                Cette matière sera ajoutée à votre stock — elle restera disponible pour tous vos futurs lots, pas seulement celui-ci.
              </Text>
              <FieldWrap label="Nom">
                <TextInput
                  style={styles.input}
                  value={newMatName}
                  onChangeText={setNewMatName}
                  placeholder="Ex: Sel, Farine…"
                  placeholderTextColor={palette.muted}
                  autoFocus
                />
              </FieldWrap>
              <FieldWrap label="Unité">
                <TextInput
                  style={styles.input}
                  value={newMatUnit}
                  onChangeText={setNewMatUnit}
                  placeholder="kg, L, g, sac…"
                  placeholderTextColor={palette.muted}
                />
              </FieldWrap>
              <FieldWrap label={materialTarget === 'formula' ? 'Quantité par unité produite (optionnel)' : 'Quantité utilisée dans ce lot (optionnel)'}>
                <TextInput
                  style={styles.input}
                  value={newMatQty}
                  onChangeText={setNewMatQty}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={palette.muted}
                />
              </FieldWrap>
              <Button
                label="Créer"
                onPress={handleCreateMaterial}
                disabled={!newMatName.trim() || !newMatUnit.trim()}
                fullWidth
                style={{ marginTop: 8 }}
              />
            </ScrollView>
          </>
        )}
      </AppModal>
    </View>
  );
}

// ── Small helpers ─────────────────────────────────────────────────

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ActionRow({
  icon, label, color, last, onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color?: string;
  last?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  return (
    <TouchableOpacity
      style={[styles.actionRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={color ?? palette.ink} />
      <Text style={[styles.actionLabel, color ? { color } : undefined]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  fill: { flex: 1 },
  pageTitle: {
    fontSize: 22, fontWeight: '700', color: palette.ink,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },

  // List
  listContent: { padding: 16, paddingBottom: 40, gap: 10 },
  todayCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: palette.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  todayTitle: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 2 },
  todayStats: { fontSize: 16, fontWeight: '700', color: palette.ink },
  // One shared card wraps the whole item list (productList); each row is
  // flat, divided by rowDivider — not individually bordered/shadowed.
  productList: {
    backgroundColor: palette.card, borderRadius: 14,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  productCard: { flexDirection: 'row', alignItems: 'center' },
  productCardMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16, gap: 8,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  productUnit: { fontSize: 13, color: palette.muted, marginTop: 2 },
  productLastMade: { fontSize: 11, color: palette.muted, textAlign: 'right', flexShrink: 1 },
  productNeverMade: { fontSize: 11, color: palette.muted, fontStyle: 'italic', flexShrink: 1 },
  productMenuBtn: {
    paddingHorizontal: 14, paddingVertical: 18,
    borderLeftWidth: 1, borderColor: palette.line,
  },
  emptyState: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: palette.muted, textAlign: 'center', fontStyle: 'italic' },

  // Log form
  logContent: { padding: 16, paddingBottom: 60, gap: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  backBtnText: { fontSize: 18, fontWeight: '700', color: palette.ink },
  card: {
    backgroundColor: palette.card, borderRadius: 14, padding: 16, gap: 12,
    borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  bigFieldLabel: { fontSize: 16, fontWeight: '700', color: palette.ink },
  unitsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitsInput: {
    flex: 1, minWidth: 0, fontSize: 36, fontWeight: '700', color: palette.ink,
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1, borderColor: palette.line,
    paddingHorizontal: 12, paddingVertical: 14, textAlign: 'center',
  },
  unitsLabel: { fontSize: 16, fontWeight: '600', color: palette.muted, flexShrink: 0, maxWidth: 80 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: palette.ink },
  formulaHint: { fontSize: 12, color: palette.muted, marginBottom: 4 },
  matRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.paper, borderRadius: 10, padding: 10,
  },
  matName: { flex: 1, fontSize: 14, fontWeight: '500', color: palette.ink },
  matQtyInput: {
    width: 72, backgroundColor: palette.card, borderRadius: 8, borderWidth: 1,
    borderColor: palette.line, padding: 8, fontSize: 14, color: palette.ink, textAlign: 'center',
  },
  matUnit: { fontSize: 13, color: palette.muted, width: 40 },
  addMatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: palette.mossSoft, borderRadius: 8,
  },
  addMatBtnText: { fontSize: 13, color: palette.moss, fontWeight: '600' },
  stockStatus: {
    backgroundColor: palette.card, borderRadius: 12, padding: 12,
    borderWidth: 2,
  },
  stockStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockStatusText: { fontSize: 14, fontWeight: '600', flex: 1 },
  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailsToggleText: { fontSize: 14, color: palette.muted, fontWeight: '500' },
  fieldWrap: { gap: 4 },
  fieldLabel: { fontSize: 13, color: palette.muted, fontWeight: '500' },
  input: {
    backgroundColor: palette.paper, borderRadius: 10, borderWidth: 1,
    borderColor: palette.line, padding: 12, fontSize: 15, color: palette.ink,
  },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: palette.moss, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: palette.white, fontSize: 17, fontWeight: '700' },

  // Toast
  toast: {
    position: 'absolute', bottom: 32, alignSelf: 'center',
    backgroundColor: palette.ink + 'EE', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 22,
  },
  toastText: { color: palette.white, fontSize: 15, fontWeight: '600' },

  // Modals
  modalTitle: { fontSize: 18, fontWeight: '700', color: palette.ink, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  backLink: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backLinkText: { fontSize: 15, color: palette.moss, fontWeight: '600' },

  // Action sheet rows (already flat — an overflow menu, not a repeated list)
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderColor: palette.line,
  },
  actionLabel: { fontSize: 16, color: palette.ink },

  // History / Picker rows — one shared card wraps the whole list
  // (historyList), rows inside are flat and divided by rowDivider, not
  // individually bordered.
  historyScroll: { maxHeight: 360 },
  historyList: {
    backgroundColor: palette.paper, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  historyRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 12, gap: 8,
  },
  historyProduct: { fontSize: 14, fontWeight: '600', color: palette.ink },
  historyDate: { fontSize: 12, fontWeight: '600', color: palette.muted },
  historyUnits: { fontSize: 14, fontWeight: '700', color: palette.moss },
  historyMats: { fontSize: 12, color: palette.muted, marginTop: 2 },
  pickerRow: { padding: 12 },
  pickerName: { fontSize: 15, color: palette.ink, fontWeight: '500' },
  pickerLevel: { fontSize: 12, color: palette.muted, marginTop: 2 },
});
