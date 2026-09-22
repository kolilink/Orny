import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppModal, Button, Card, ConfirmDialog, Text } from '../../components/ui';
import { radius, spacing, typography, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import {
  addMachine,
  deleteMachine,
  getMachines,
  syncMachinesFromSupabase,
  updateMachine,
  updateMachineStatus,
} from '../../store/machines';
import { Machine, MachineStatus } from '../../types';

const STATUS_LABEL: Record<MachineStatus, string> = {
  running: 'En marche',
  idle: 'À l’arrêt',
  down: 'En panne',
  maintenance: 'Maintenance',
};

const makeStatusColor = (palette: Palette): Record<MachineStatus, { fg: string; bg: string }> => ({
  running: { fg: palette.moss, bg: palette.mossSoft },
  idle: { fg: palette.muted, bg: palette.line },
  down: { fg: palette.critical, bg: palette.criticalSoft },
  maintenance: { fg: palette.caution, bg: palette.cautionSoft },
});

const STATUS_ORDER: MachineStatus[] = ['running', 'idle', 'maintenance', 'down'];

export default function MachinesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const STATUS_COLOR = makeStatusColor(palette);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [statusFor, setStatusFor] = useState<Machine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Machine | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [ratedCapacity, setRatedCapacity] = useState('');
  const [capacityUnit, setCapacityUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getMachines().then(setMachines);
    syncMachinesFromSupabase().then(() => getMachines().then(setMachines));
  }, []);

  useFocusEffect(load);

  function openAdd() {
    setEditing(null);
    setName('');
    setType('');
    setRatedCapacity('');
    setCapacityUnit('');
    setNotes('');
    setShowForm(true);
  }

  function openEdit(m: Machine) {
    setEditing(m);
    setName(m.name);
    setType(m.type);
    setRatedCapacity(m.ratedCapacity !== null ? String(m.ratedCapacity) : '');
    setCapacityUnit(m.capacityUnit ?? '');
    setNotes(m.notes ?? '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const parsedCapacity = ratedCapacity.trim() ? Number(ratedCapacity.replace(',', '.')) : null;
    if (editing) {
      await updateMachine(editing.id, {
        name: name.trim(),
        type: type.trim(),
        ratedCapacity: parsedCapacity,
        capacityUnit: capacityUnit.trim() || null,
        notes: notes.trim() || undefined,
      });
    } else {
      await addMachine({
        name: name.trim(),
        type: type.trim(),
        ratedCapacity: parsedCapacity,
        capacityUnit: capacityUnit.trim() || null,
        status: 'idle',
        notes: notes.trim() || undefined,
      });
    }
    setSaving(false);
    setShowForm(false);
    load();
  }

  async function handleStatusChange(status: MachineStatus) {
    if (!statusFor) return;
    await updateMachineStatus(statusFor.id, status);
    setStatusFor(null);
    load();
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    await deleteMachine(confirmDelete.id);
    setConfirmDelete(null);
    load();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Machines</Text>
        <TouchableOpacity onPress={openAdd} hitSlop={8}>
          <Ionicons name="add-circle" size={26} color={palette.moss} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={machines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const tone = STATUS_COLOR[item.status];
          return (
            <Card style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.machineName}>{item.name}</Text>
                  {!!item.type && <Text style={styles.machineType}>{item.type}</Text>}
                  {item.ratedCapacity !== null && (
                    <Text style={styles.machineCapacity}>
                      Capacité : {item.ratedCapacity} {item.capacityUnit ?? ''}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.statusPill, { backgroundColor: tone.bg }]}
                  onPress={() => setStatusFor(item)}
                >
                  <Text style={[styles.statusText, { color: tone.fg }]}>{STATUS_LABEL[item.status]}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="hardware-chip-outline" size={40} color={palette.line} />
            <Text style={styles.emptyText}>Aucune machine enregistrée</Text>
            <Text style={styles.emptyHint}>Ajoutez vos machines pour que Claude puisse voir leur capacité et leur statut.</Text>
          </View>
        }
      />

      {/* Add / edit form */}
      <AppModal visible={showForm} onClose={() => setShowForm(false)} title={editing ? 'Modifier la machine' : 'Nouvelle machine'}>
        <TextInput
          style={styles.input}
          placeholder="Nom de la machine"
          placeholderTextColor={palette.muted}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Type (ex : friteuse, emballeuse...)"
          placeholderTextColor={palette.muted}
          value={type}
          onChangeText={setType}
        />
        <View style={styles.capacityRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Capacité nominale"
            placeholderTextColor={palette.muted}
            value={ratedCapacity}
            onChangeText={setRatedCapacity}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Unité (kg/h, unités/h...)"
            placeholderTextColor={palette.muted}
            value={capacityUnit}
            onChangeText={setCapacityUnit}
          />
        </View>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder="Notes (optionnel)"
          placeholderTextColor={palette.muted}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <Button label={editing ? 'Enregistrer' : 'Ajouter'} onPress={handleSave} loading={saving} disabled={!name.trim()} fullWidth />
        {editing && (
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={() => { setShowForm(false); setConfirmDelete(editing); }}
          >
            <Text style={styles.deleteText}>Supprimer cette machine</Text>
          </TouchableOpacity>
        )}
      </AppModal>

      {/* Status picker */}
      <AppModal visible={!!statusFor} onClose={() => setStatusFor(null)} title="Changer le statut">
        {STATUS_ORDER.map((status) => {
          const tone = STATUS_COLOR[status];
          return (
            <TouchableOpacity
              key={status}
              style={[styles.statusOption, { backgroundColor: tone.bg }]}
              onPress={() => handleStatusChange(status)}
            >
              <Text style={[styles.statusOptionText, { color: tone.fg }]}>{STATUS_LABEL[status]}</Text>
            </TouchableOpacity>
          );
        })}
      </AppModal>

      <ConfirmDialog
        visible={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Supprimer cette machine ?"
        message={confirmDelete ? `"${confirmDelete.name}" sera définitivement supprimée.` : undefined}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        icon="trash-outline"
        tone="danger"
      />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.screenTitle, color: palette.ink },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  card: {},
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  machineName: { ...typography.bodyBold, color: palette.ink },
  machineType: { ...typography.caption, color: palette.muted, marginTop: 2 },
  machineCapacity: { ...typography.caption, color: palette.muted, marginTop: 2 },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusText: { fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyText: { ...typography.body, color: palette.muted, fontWeight: '600' },
  emptyHint: { ...typography.caption, color: palette.muted, textAlign: 'center' },
  input: {
    borderWidth: 1, borderColor: palette.line, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 15, color: palette.ink, backgroundColor: palette.paper, marginBottom: spacing.sm,
  },
  capacityRow: { flexDirection: 'row', gap: spacing.sm },
  deleteRow: { alignItems: 'center', paddingVertical: spacing.md },
  deleteText: { color: palette.critical, fontWeight: '600', fontSize: 14 },
  statusOption: { borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  statusOptionText: { fontSize: 15, fontWeight: '700' },
});
