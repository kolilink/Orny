import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { getInvestors, addInvestor, syncInvestorsFromSupabase } from '../../store/investors';
import { getInvestmentEntries, syncInvestmentEntriesFromSupabase } from '../../store/investmentEntries';
import { getDistributions, syncDistributionsFromSupabase } from '../../store/investorDistributions';
import { Investor, InvestmentEntry, InvestorDistribution, RootStackParamList } from '../../types';
import { formatGNF } from '../../utils/format';
import { toDateString } from '../../utils/dates';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, MoneyInput, Text } from '../../components/ui';

type InvestorsNav = NativeStackNavigationProp<RootStackParamList>;

type NewInvestorForm = { name: string; initialAmount: string };
const EMPTY_FORM: NewInvestorForm = { name: '', initialAmount: '' };

// Just the people, and one number each — everything about what any one of
// them actually did (when, how much, editing, withdrawals) lives on their
// own account screen (InvestorDetail) instead of being crammed into this
// list. Mirrors the exact same split Suppliers went through: a plain list
// here, a real detail screen for the account itself.
export default function InvestorsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const navigation = useNavigation<InvestorsNav>();
  const { membership, user } = useAuth();
  // Manager gets the same write access as admin here (db/update27.sql) —
  // see the identical note in InvestorDetail.tsx.
  const canManage = membership?.role === 'admin' || membership?.role === 'manager';
  const isInvestor = membership?.role === 'investor';

  const [investors, setInvestors] = useState<Investor[]>([]);
  const [entries, setEntries] = useState<InvestmentEntry[]>([]);
  const [distributions, setDistributions] = useState<InvestorDistribution[]>([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<NewInvestorForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [inv, ent, dist] = await Promise.all([getInvestors(), getInvestmentEntries(), getDistributions()]);
    setInvestors(inv);
    setEntries(ent);
    setDistributions(dist);
    await Promise.all([syncInvestorsFromSupabase(), syncInvestmentEntriesFromSupabase(), syncDistributionsFromSupabase()]);
    const [freshInv, freshEnt, freshDist] = await Promise.all([getInvestors(), getInvestmentEntries(), getDistributions()]);
    setInvestors(freshInv);
    setEntries(freshEnt);
    setDistributions(freshDist);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visibleInvestors = isInvestor ? investors.filter((inv) => inv.userId === user?.id) : investors;

  const totalForInvestor = (investor: Investor): number => {
    const entriesSum = entries.filter((e) => e.investorId === investor.id).reduce((sum, e) => sum + e.amount, 0);
    const distSum = distributions.filter((d) => d.investorId === investor.id).reduce((sum, d) => sum + d.amount, 0);
    return investor.amountInvested + entriesSum - distSum;
  };

  const grandTotal = investors.reduce((sum, inv) => sum + totalForInvestor(inv), 0);
  const totalShares = investors.reduce((sum, inv) => sum + inv.sharePercentage, 0);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setShowAddModal(true);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isInvestor ? 'Mon investissement' : 'Investisseurs',
      headerRight: () => canManage ? (
        <TouchableOpacity onPress={openAdd} hitSlop={8}>
          <Ionicons name="add" size={26} color={palette.moss} />
        </TouchableOpacity>
      ) : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isInvestor, canManage, palette.moss]);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const initialAmount = parseFloat(form.initialAmount) || 0;
      await addInvestor({ name: form.name.trim(), amountInvested: initialAmount, sharePercentage: 0, notes: '' });
      await load();
      setShowAddModal(false);
    } catch (e: any) {
      // Without this, a real (non-network) rejection — e.g. an RLS denial —
      // used to be swallowed entirely inside addInvestor: the modal stayed
      // open with no explanation, which read as "the button doesn't work."
      Alert.alert('Erreur', `Impossible d'ajouter l'investisseur. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  if (isInvestor && visibleInvestors.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyWrap}>
          <Ionicons name="information-circle-outline" size={48} color={palette.muted} />
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
    <View style={styles.container}>
      {isInvestor && (
        <View style={styles.readOnlyBanner}>
          <Ionicons name="eye-outline" size={14} color={palette.muted} />
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
              <Text style={[styles.summaryValue, { color: palette.moss }]}>{(100 - totalShares).toFixed(1)}%</Text>
            </View>
          </>
        )}
      </View>

      <FlatList
        data={visibleInvestors}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visibleInvestors.length > 0 ? styles.listContent : styles.list}
        ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="trending-up-outline" size={48} color={palette.muted} />
            <Text style={styles.emptyText}>Aucun investisseur</Text>
            {canManage && <Text style={styles.emptyHint}>Appuyez sur + pour ajouter un investisseur</Text>}
          </View>
        }
        renderItem={({ item }) => {
          const total = totalForInvestor(item);
          const capitalShare = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('InvestorDetail', { investorId: item.id })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.investorName}>{item.name}</Text>
                <Text style={styles.investorSub}>{formatGNF(total)} · {capitalShare.toFixed(1)}% du capital</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.muted} />
            </TouchableOpacity>
          );
        }}
      />

      {/* New investor */}
      <AppModal visible={showAddModal} onClose={() => setShowAddModal(false)} title="Nouvel investisseur">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Nom *</Text>
          <TextInput style={styles.input} placeholder="Nom de l'investisseur" placeholderTextColor={palette.muted} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} autoFocus />
          <Text style={styles.fieldLabel}>Premier apport (GNF)</Text>
          <MoneyInput style={styles.input} value={form.initialAmount} onChangeText={(v) => setForm((f) => ({ ...f, initialAmount: v }))} />
          <View style={styles.modalActions}>
            <Button label="Annuler" variant="ghost" onPress={() => setShowAddModal(false)} style={{ flex: 1 }} />
            <Button label="Ajouter" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.line, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.line },
  readOnlyText: { fontSize: 12, color: palette.muted },
  summaryCard: { backgroundColor: palette.card, margin: 16, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', padding: 16 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 11, color: palette.muted, marginBottom: 4, textAlign: 'center' },
  summaryValue: { fontSize: 15, fontWeight: '700', color: palette.ink, textAlign: 'center' },
  divider: { width: 1, backgroundColor: palette.line, marginHorizontal: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  // One shared card wraps the whole list; rows are flat, divided by
  // rowDivider — not individually bordered/shadowed.
  listContent: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: palette.card,
    borderRadius: 12, borderWidth: 1, borderColor: palette.line, overflow: 'hidden',
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  emptyWrap: { alignItems: 'center', paddingTop: 40, gap: 8, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: palette.muted },
  emptyHint: { fontSize: 13, color: palette.muted, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: palette.moss },
  investorName: { fontSize: 16, fontWeight: '600', color: palette.ink },
  investorSub: { fontSize: 13, color: palette.muted, marginTop: 2 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.ink, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1, borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
