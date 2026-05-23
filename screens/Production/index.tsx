import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Modal,
  FlatList, Animated, Alert, StyleProp, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getProducts, addProduct, updateProduct, deleteProduct } from '../../store/products';
import { getBatches, addBatch } from '../../store/batches';
import { getStock, deductStock, updateStock, addStockItem } from '../../store/stock';
import DatePickerField from '../../components/DatePickerField';
import { toDateString } from '../../utils/dates';
import { Product, Batch, StockItem } from '../../types';

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

type ScreenState = 'list' | 'log';
type MaterialRow = { rawMaterialId: string; name: string; quantity: string; unit: string };

export default function ProductionScreen() {
  const insets = useSafeAreaInsets();

  // ── Data ──────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  // ── Screen state ──────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>('list');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

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
  const [newProductModal, setNewProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('');
  const [creatingProduct, setCreatingProduct] = useState(false);

  const [todayModal, setTodayModal] = useState(false);

  const [actionsProduct, setActionsProduct] = useState<Product | null>(null);
  const [productActionsModal, setProductActionsModal] = useState(false);

  const [renameModal, setRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameUnitValue, setRenameUnitValue] = useState('');

  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [batchHistoryModal, setBatchHistoryModal] = useState(false);

  const [materialPickerModal, setMaterialPickerModal] = useState(false);

  const [newMatModal, setNewMatModal] = useState(false);
  const [newMatName, setNewMatName] = useState('');
  const [newMatUnit, setNewMatUnit] = useState('');

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
  const load = useCallback(async () => {
    const [p, b, s] = await Promise.all([getProducts(), getBatches(), getStock()]);
    setProducts(p);
    setBatches(b);
    setStockItems(s);
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

  // ── Select product → go to log state ─────────────────────────────
  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    setUnits('');
    setLogDate(toDateString());
    setEnergy('');
    setHours('');
    setNotes('');
    setDetailsOpen(false);
    setMaterials(
      p.lastRecipe.length > 0
        ? p.lastRecipe.map((r) => ({
            rawMaterialId: r.rawMaterialId,
            name: r.name,
            quantity: String(r.quantity),
            unit: r.unit,
          }))
        : []
    );
    setScreenState('log');
  };

  const backToList = () => {
    setScreenState('list');
    setSelectedProduct(null);
  };

  // ── Material helpers ──────────────────────────────────────────────
  const addMaterialFromStock = (item: StockItem) => {
    if (!materials.find((m) => m.rawMaterialId === item.id)) {
      setMaterials((prev) => [
        ...prev,
        { rawMaterialId: item.id, name: item.name, quantity: '', unit: item.unit },
      ]);
    }
    setMaterialPickerModal(false);
  };

  const removeMaterial = (idx: number) => {
    setMaterials((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMaterialQty = (idx: number, qty: string) => {
    setMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, quantity: qty } : m)));
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
        productId: selectedProduct!.id,
        productName: selectedProduct!.name,
        unitsProduced: unitsNum,
        materialsUsed: validMaterials,
        energyUsed: energy ? parseFloat(energy) : undefined,
        hoursWorked: hours ? parseFloat(hours) : undefined,
        notes: notes || undefined,
      });

      // Update product memory (lastRecipe)
      await updateProduct(selectedProduct!.id, { lastRecipe: validMaterials });

      // Deduct raw materials from stock
      const deductions: Record<string, number> = {};
      for (const m of validMaterials) {
        if (m.rawMaterialId && m.quantity > 0) {
          deductions[m.rawMaterialId] = (deductions[m.rawMaterialId] ?? 0) + m.quantity;
        }
      }
      await deductStock(deductions);

      // Increment finished product stock
      const finishedItem = stockItems.find((s) => s.id === selectedProduct!.id);
      if (finishedItem) {
        await updateStock({ [selectedProduct!.id]: finishedItem.currentLevel + unitsNum });
      }

      await load();
      backToList();
      showToast('✅ Lot enregistré');
    } finally {
      setSaving(false);
    }
  };

  // ── Create new product ────────────────────────────────────────────
  const handleCreateProduct = async () => {
    if (!newProductName.trim()) return;
    setCreatingProduct(true);
    try {
      await addProduct(newProductName.trim(), newProductUnit.trim() || 'unité');
      setNewProductName('');
      setNewProductUnit('');
      setNewProductModal(false);
      await load();
    } finally {
      setCreatingProduct(false);
    }
  };

  // ── Create new raw material inline ────────────────────────────────
  const handleCreateMaterial = async () => {
    if (!newMatName.trim() || !newMatUnit.trim()) return;
    const item = await addStockItem({
      name: newMatName.trim(),
      unit: newMatUnit.trim(),
      currentLevel: 0,
      alertThreshold: 0,
    });
    setMaterials((prev) => [
      ...prev,
      { rawMaterialId: item.id, name: item.name, quantity: '', unit: item.unit },
    ]);
    setNewMatName('');
    setNewMatUnit('');
    setNewMatModal(false);
    // reload stock so picker shows the new item next time
    getStock().then(setStockItems);
  };

  // ── Delete product ────────────────────────────────────────────────
  const handleDeleteProduct = (p: Product) => {
    const hasBatches = batches.some((b) => b.productId === p.id);
    Alert.alert(
      'Supprimer',
      hasBatches
        ? `Supprimer "${p.name}" ? L'historique des lots sera conservé.`
        : `Supprimer "${p.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteProduct(p.id);
            setProductActionsModal(false);
            await load();
          },
        },
      ]
    );
  };

  // ── Render: STATE 1 — product list ────────────────────────────────
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
        <Ionicons name="chevron-forward" size={18} color="#BABAB6" />
      </TouchableOpacity>

      {/* New product button */}
      <TouchableOpacity style={styles.newProductBtn} onPress={() => setNewProductModal(true)}>
        <Ionicons name="add-circle-outline" size={20} color={C.primary} />
        <Text style={styles.newProductBtnText}>Nouveau produit</Text>
      </TouchableOpacity>

      {/* Product list */}
      {products.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Créez votre premier produit pour commencer à enregistrer des lots.</Text>
        </View>
      ) : (
        products.map((p) => (
          <View key={p.id} style={styles.productCard}>
            <TouchableOpacity
              style={styles.productCardMain}
              onPress={() => selectProduct(p)}
              activeOpacity={0.7}
            >
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{p.name}</Text>
                <Text style={styles.productUnit}>{p.unit}</Text>
              </View>
              <Text style={lastBatchDate[p.id] ? styles.productLastMade : styles.productNeverMade}>
                {lastBatchDate[p.id] ? `Dernière fois: ${lastBatchDate[p.id]}` : 'Jamais produit'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.productMenuBtn}
              onPress={() => { setActionsProduct(p); setProductActionsModal(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>
        ))
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
          <Ionicons name="arrow-back" size={22} color={C.primary} />
          <Text style={styles.backBtnText}>{selectedProduct?.name}</Text>
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
              placeholderTextColor="#BABAB6"
              autoFocus
            />
            <Text style={styles.unitsLabel} numberOfLines={2}>{selectedProduct?.unit}</Text>
          </View>
        </View>

        {/* Matières utilisées */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Matières utilisées</Text>
          {materials.map((m, idx) => (
            <View key={idx} style={styles.matRow}>
              <Text style={styles.matName}>{m.name}</Text>
              <TextInput
                style={styles.matQtyInput}
                value={m.quantity}
                onChangeText={(v) => updateMaterialQty(idx, v)}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#BABAB6"
              />
              <Text style={styles.matUnit}>{m.unit}</Text>
              <TouchableOpacity onPress={() => removeMaterial(idx)}>
                <Ionicons name="close-circle-outline" size={22} color={C.red} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addMatBtn} onPress={() => setMaterialPickerModal(true)}>
            <Ionicons name="add" size={18} color={C.primary} />
            <Text style={styles.addMatBtnText}>Ajouter une matière</Text>
          </TouchableOpacity>
        </View>

        {/* Stock status */}
        {hasMaterialsWithQty && (
          <View style={[
            styles.stockStatus,
            { borderColor: stockOk ? C.primary + '44' : C.orange + '66' },
          ]}>
            {stockOk ? (
              <Text style={[styles.stockStatusText, { color: C.primary }]}>
                ✅ Tu as tout en stock
              </Text>
            ) : (
              <Text style={[styles.stockStatusText, { color: '#A06000' }]}>
                ⚠️ Il te manque: {missingItems.join(', ')}
              </Text>
            )}
          </View>
        )}

        {/* Plus de détails */}
        <TouchableOpacity style={styles.detailsToggle} onPress={() => setDetailsOpen(!detailsOpen)}>
          <Text style={styles.detailsToggleText}>Plus de détails</Text>
          <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
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
                placeholderTextColor="#BABAB6"
              />
            </FieldWrap>
            <FieldWrap label="Heures travaillées">
              <TextInput
                style={styles.input}
                value={hours}
                onChangeText={setHours}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#BABAB6"
              />
            </FieldWrap>
            <FieldWrap label="Notes">
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Notes optionnelles…"
                placeholderTextColor="#BABAB6"
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

      {/* ── NEW PRODUCT MODAL ── */}
      <Modal
        visible={newProductModal}
        transparent
        animationType="slide"
        onRequestClose={() => setNewProductModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Nouveau produit</Text>
              <FieldWrap label="Nom du produit">
                <TextInput
                  style={styles.input}
                  value={newProductName}
                  onChangeText={setNewProductName}
                  placeholder="Ex: SOL Original 50g"
                  placeholderTextColor="#BABAB6"
                  autoFocus
                />
              </FieldWrap>
              <FieldWrap label="Unité">
                <TextInput
                  style={styles.input}
                  value={newProductUnit}
                  onChangeText={setNewProductUnit}
                  placeholder="sachet, kg, bouteille, L…"
                  placeholderTextColor="#BABAB6"
                />
              </FieldWrap>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setNewProductModal(false); setNewProductName(''); setNewProductUnit(''); }}
                >
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, (!newProductName.trim() || creatingProduct) && { opacity: 0.4 }]}
                  onPress={handleCreateProduct}
                  disabled={!newProductName.trim() || creatingProduct}
                >
                  <Text style={styles.confirmText}>
                    {creatingProduct ? 'Création…' : 'Créer'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── TODAY'S BATCHES MODAL ── */}
      <Modal
        visible={todayModal}
        transparent
        animationType="slide"
        onRequestClose={() => setTodayModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Lots d'aujourd'hui</Text>
            {todayBatches.length === 0 ? (
              <Text style={styles.emptyText}>Aucun lot enregistré aujourd'hui.</Text>
            ) : (
              <FlatList
                data={todayBatches}
                keyExtractor={(b) => b.id}
                style={styles.modalList}
                renderItem={({ item }) => {
                  const prod = products.find((p) => p.id === item.productId);
                  return (
                    <View style={styles.historyRow}>
                      <Text style={styles.historyProduct}>{item.productName}</Text>
                      <Text style={styles.historyUnits}>
                        {item.unitsProduced} {prod?.unit ?? ''}
                      </Text>
                    </View>
                  );
                }}
              />
            )}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setTodayModal(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── PRODUCT ACTIONS MODAL ── */}
      <Modal
        visible={productActionsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setProductActionsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{actionsProduct?.name}</Text>
            <ActionRow
              icon="pencil-outline"
              label="Renommer"
              onPress={() => {
                setRenameValue(actionsProduct?.name ?? '');
                setRenameUnitValue(actionsProduct?.unit ?? '');
                setProductActionsModal(false);
                setRenameModal(true);
              }}
            />
            <ActionRow
              icon="time-outline"
              label="Voir l'historique"
              onPress={() => {
                setHistoryProduct(actionsProduct);
                setProductActionsModal(false);
                setBatchHistoryModal(true);
              }}
            />
            <ActionRow
              icon="trash-outline"
              label="Supprimer"
              color={C.red}
              last
              onPress={() => {
                if (actionsProduct) handleDeleteProduct(actionsProduct);
              }}
            />
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setProductActionsModal(false)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── RENAME MODAL ── */}
      <Modal
        visible={renameModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRenameModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Modifier le produit</Text>
              <FieldWrap label="Nom">
                <TextInput
                  style={styles.input}
                  value={renameValue}
                  onChangeText={setRenameValue}
                  autoFocus
                />
              </FieldWrap>
              <FieldWrap label="Unité">
                <TextInput
                  style={styles.input}
                  value={renameUnitValue}
                  onChangeText={setRenameUnitValue}
                />
              </FieldWrap>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenameModal(false)}>
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, !renameValue.trim() && { opacity: 0.4 }]}
                  disabled={!renameValue.trim()}
                  onPress={async () => {
                    if (actionsProduct && renameValue.trim()) {
                      await updateProduct(actionsProduct.id, {
                        name: renameValue.trim(),
                        unit: renameUnitValue.trim() || actionsProduct.unit,
                      });
                      setRenameModal(false);
                      await load();
                    }
                  }}
                >
                  <Text style={styles.confirmText}>Enregistrer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── BATCH HISTORY MODAL ── */}
      <Modal
        visible={batchHistoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setBatchHistoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{historyProduct?.name}</Text>
            <FlatList
              data={batches.filter((b) => b.productId === historyProduct?.id)}
              keyExtractor={(b) => b.id}
              style={styles.modalList}
              renderItem={({ item }) => (
                <View style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>{item.date}</Text>
                    <Text style={styles.historyMats} numberOfLines={2}>
                      {item.materialsUsed.map((m) => `${m.quantity}${m.unit} ${m.name}`).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.historyUnits}>
                    {item.unitsProduced} {historyProduct?.unit}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>Aucun lot enregistré.</Text>}
            />
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setBatchHistoryModal(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── MATERIAL PICKER MODAL ── */}
      <Modal
        visible={materialPickerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMaterialPickerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ajouter une matière</Text>
            <FlatList
              data={stockItems.filter((s) => s.id !== selectedProduct?.id)}
              keyExtractor={(s) => s.id}
              style={styles.modalList}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => addMaterialFromStock(item)}>
                  <Text style={styles.pickerName}>{item.name}</Text>
                  <Text style={styles.pickerLevel}>{item.currentLevel} {item.unit} en stock</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>Aucun article en stock.</Text>}
            />
            <TouchableOpacity
              style={styles.addMatBtn}
              onPress={() => { setMaterialPickerModal(false); setNewMatModal(true); }}
            >
              <Ionicons name="add" size={18} color={C.primary} />
              <Text style={styles.addMatBtnText}>+ Nouvelle matière première</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setMaterialPickerModal(false)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── NEW MATERIAL MODAL ── */}
      <Modal
        visible={newMatModal}
        transparent
        animationType="slide"
        onRequestClose={() => setNewMatModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Nouvelle matière première</Text>
              <FieldWrap label="Nom">
                <TextInput
                  style={styles.input}
                  value={newMatName}
                  onChangeText={setNewMatName}
                  placeholder="Ex: Sel, Farine…"
                  placeholderTextColor="#BABAB6"
                  autoFocus
                />
              </FieldWrap>
              <FieldWrap label="Unité">
                <TextInput
                  style={styles.input}
                  value={newMatUnit}
                  onChangeText={setNewMatUnit}
                  placeholder="kg, L, g, sac…"
                  placeholderTextColor="#BABAB6"
                />
              </FieldWrap>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setNewMatModal(false); setNewMatName(''); setNewMatUnit(''); }}
                >
                  <Text style={styles.cancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, (!newMatName.trim() || !newMatUnit.trim()) && { opacity: 0.4 }]}
                  onPress={handleCreateMaterial}
                  disabled={!newMatName.trim() || !newMatUnit.trim()}
                >
                  <Text style={styles.confirmText}>Créer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Small helpers ─────────────────────────────────────────────────

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
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
  return (
    <TouchableOpacity
      style={[styles.actionRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={color ?? C.text} />
      <Text style={[styles.actionLabel, color ? { color } : undefined]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  pageTitle: {
    fontSize: 22, fontWeight: '700', color: C.text,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },

  // List
  listContent: { padding: 16, paddingBottom: 40, gap: 10 },
  todayCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  todayTitle: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 2 },
  todayStats: { fontSize: 16, fontWeight: '700', color: C.text },
  newProductBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#E8F6F0', borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: C.primary + '44',
  },
  newProductBtnText: { fontSize: 15, fontWeight: '700', color: C.primary },
  productCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  productCardMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16, gap: 8,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 16, fontWeight: '600', color: C.text },
  productUnit: { fontSize: 13, color: C.muted, marginTop: 2 },
  productLastMade: { fontSize: 11, color: C.muted, textAlign: 'right', flexShrink: 1 },
  productNeverMade: { fontSize: 11, color: '#BABAB6', fontStyle: 'italic', flexShrink: 1 },
  productMenuBtn: {
    paddingHorizontal: 14, paddingVertical: 18,
    borderLeftWidth: 1, borderColor: C.border,
  },
  emptyState: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: C.muted, textAlign: 'center', fontStyle: 'italic' },

  // Log form
  logContent: { padding: 16, paddingBottom: 60, gap: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  backBtnText: { fontSize: 18, fontWeight: '700', color: C.text },
  card: {
    backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 12,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  bigFieldLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  unitsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitsInput: {
    flex: 1, minWidth: 0, fontSize: 36, fontWeight: '700', color: C.text,
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 14, textAlign: 'center',
  },
  unitsLabel: { fontSize: 16, fontWeight: '600', color: C.muted, flexShrink: 0, maxWidth: 80 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  matRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg, borderRadius: 10, padding: 10,
  },
  matName: { flex: 1, fontSize: 14, fontWeight: '500', color: C.text },
  matQtyInput: {
    width: 72, backgroundColor: C.card, borderRadius: 8, borderWidth: 1,
    borderColor: C.border, padding: 8, fontSize: 14, color: C.text, textAlign: 'center',
  },
  matUnit: { fontSize: 13, color: C.muted, width: 40 },
  addMatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#E8F6F0', borderRadius: 8,
  },
  addMatBtnText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  stockStatus: {
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 2,
  },
  stockStatusText: { fontSize: 14, fontWeight: '600' },
  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailsToggleText: { fontSize: 14, color: C.muted, fontWeight: '500' },
  fieldWrap: { gap: 4 },
  fieldLabel: { fontSize: 13, color: C.muted, fontWeight: '500' },
  input: {
    backgroundColor: C.bg, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, padding: 12, fontSize: 15, color: C.text,
  },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  // Toast
  toast: {
    position: 'absolute', bottom: 32, alignSelf: 'center',
    backgroundColor: '#1A1A18EE', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 22,
  },
  toastText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 24, paddingBottom: 40, maxHeight: '88%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  modalList: { maxHeight: 320, marginBottom: 4 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 12, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 15, color: C.muted, fontWeight: '600' },
  confirmBtn: {
    flex: 1, height: 50, borderRadius: 12, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' },

  // Action sheet rows
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderColor: C.border,
  },
  actionLabel: { fontSize: 16, color: C.text },

  // History / Picker rows
  historyRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F0F0EE', gap: 8,
  },
  historyProduct: { fontSize: 14, fontWeight: '600', color: C.text },
  historyDate: { fontSize: 12, fontWeight: '600', color: C.muted },
  historyUnits: { fontSize: 14, fontWeight: '700', color: C.primary },
  historyMats: { fontSize: 12, color: C.muted, marginTop: 2 },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F0F0EE' },
  pickerName: { fontSize: 15, color: C.text, fontWeight: '500' },
  pickerLevel: { fontSize: 12, color: C.muted, marginTop: 2 },
});
