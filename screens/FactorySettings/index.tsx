import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Clipboard, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { getWeeklyTarget, setWeeklyTarget } from '../../store/weeklyTarget';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, UserRole, MemberDisplay, JoinRequestDisplay } from '../../context/AuthContext';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';
import { AppModal, Button } from '../../components/ui';

type ReconciliationFinding = {
  severity: 'critical' | 'warning';
  check_name: string;
  entity_type: string;
  entity_id: string | null;
  message: string;
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  employee: 'Employé',
  investor: 'Investisseur',
  vendeur: 'Vendeur',
  inspecteur: 'Inspecteur',
};

// admin tracks the live brand accent (palette.moss) — the other four are
// deliberately distinct fixed hues outside the main palette, since a role
// badge needs more distinguishable colors than the app's 1-accent design
// otherwise provides, and those don't clash with the cool-neutral scheme.
const makeRoleColors = (palette: Palette): Record<UserRole, string> => ({
  admin: palette.moss,
  employee: '#5B8AF5',
  investor: '#EF9F27',
  vendeur: '#8E44AD',
  inspecteur: '#3E5C76',
});

const CODE_TTL = 60;

export default function FactorySettingsScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const ROLE_COLORS = makeRoleColors(palette);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    membership,
    getMembers, updateMemberRole, removeMember, regenerateInviteCode, getInviteCode,
    getPendingRequests, approveJoinRequest, rejectJoinRequest,
  } = useAuth();

  const [members, setMembers] = useState<MemberDisplay[]>([]);
  const [pendingRequests, setPendingRequests] = useState<JoinRequestDisplay[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(CODE_TTL);
  const [regenLoading, setRegenLoading] = useState(false);
  const [weeklyTarget, setWeeklyTargetState] = useState(1000);
  const [targetModal, setTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [approveModal, setApproveModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<JoinRequestDisplay | null>(null);
  const [memberModal, setMemberModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberDisplay | null>(null);
  const [removeConfirmModal, setRemoveConfirmModal] = useState(false);
  const [regenConfirmModal, setRegenConfirmModal] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<JoinRequestDisplay | null>(null);
  const [checkModal, setCheckModal] = useState(false);
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkFindings, setCheckFindings] = useState<ReconciliationFinding[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const isAdmin = membership?.role === 'admin';

  async function doRegen(): Promise<{ error: string | null }> {
    setRegenLoading(true);
    const { error } = await regenerateInviteCode();
    if (!error) {
      const code = await getInviteCode();
      setInviteCode(code);
    }
    setRegenLoading(false);
    return { error: error ?? null };
  }

  const regenRef = useRef(doRegen);
  regenRef.current = doRegen;

  async function runReconciliation() {
    if (!membership) return;
    setCheckModal(true);
    setCheckRunning(true);
    setCheckError(null);
    setCheckFindings(null);
    const { data, error } = await supabase.rpc('run_factory_reconciliation', { p_factory_id: membership.factoryId });
    if (error) {
      setCheckError(error.message);
    } else {
      setCheckFindings((data ?? []) as ReconciliationFinding[]);
    }
    setCheckRunning(false);
  }

  async function load() {
    const [mems, reqs, code, target] = await Promise.all([
      getMembers(),
      isAdmin ? getPendingRequests() : Promise.resolve([]),
      isAdmin ? getInviteCode() : Promise.resolve(null),
      getWeeklyTarget(),
    ]);
    setMembers(mems);
    setPendingRequests(reqs);
    if (isAdmin) setInviteCode(code);
    setWeeklyTargetState(target);
  }

  async function saveWeeklyTarget() {
    const n = parseInt(targetInput, 10);
    if (!n || n < 1) { Alert.alert('Valeur invalide', 'Entrez un objectif supérieur à 0.'); return; }
    await setWeeklyTarget(n);
    setWeeklyTargetState(n);
    setTargetModal(false);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    if (!isAdmin) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          regenRef.current().catch(console.error);
          return CODE_TTL;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  useEffect(() => {
    setCountdown(CODE_TTL);
  }, [inviteCode]);

  function handleManualRegen() {
    setRegenConfirmModal(true);
  }

  function copyInviteCode() {
    if (!inviteCode) return;
    if (Platform.OS === 'web') {
      navigator.clipboard.writeText(inviteCode).catch(() => {});
    } else {
      Clipboard.setString(inviteCode);
    }
    Alert.alert('Copié !', `Code d'invitation : ${inviteCode}`);
  }

  function handleMemberOptions(member: MemberDisplay) {
    if (member.isCurrentUser) return;
    setSelectedMember(member);
    setMemberModal(true);
  }

  function handleApproveRequest(req: JoinRequestDisplay) {
    setSelectedRequest(req);
    setApproveModal(true);
  }

  async function confirmApprove(role: UserRole) {
    if (!selectedRequest) return;
    setApproveModal(false);
    const { error } = await approveJoinRequest(selectedRequest.id, selectedRequest.userId, role);
    if (error) Alert.alert('Erreur', error);
    else await load();
    setSelectedRequest(null);
  }

  function handleRejectRequest(req: JoinRequestDisplay) {
    setRejectTarget(req);
  }

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={palette.moss} />
      </View>
    );
  }

  const pct = countdown / CODE_TTL;
  const barColor = pct > 0.4 ? palette.moss : pct > 0.2 ? palette.caution : palette.critical;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.moss} />}
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color={palette.moss} />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Paramètres usine</Text>
      <Text style={styles.factoryName}>{membership?.factoryName}</Text>

      {/* Invite Code — admin only */}
      {isAdmin && (
        <>
          <Text style={styles.sectionTitle}>Code d'invitation</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Partagez ce code pour inviter des membres</Text>

            <View style={styles.codeRow}>
              {regenLoading
                ? <ActivityIndicator color={palette.moss} style={{ flex: 1 }} />
                : <Text style={styles.codeText}>{inviteCode ?? '—'}</Text>}
              <TouchableOpacity style={styles.copyBtn} onPress={copyInviteCode} disabled={regenLoading || !inviteCode}>
                <Ionicons name="copy-outline" size={18} color={palette.moss} />
                <Text style={styles.copyText}>Copier</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
            </View>
            <View style={styles.timerRow}>
              <Text style={[styles.timerText, { color: barColor }]}>
                Nouveau code dans {countdown}s
              </Text>
              <TouchableOpacity style={styles.regenBtn} onPress={handleManualRegen} disabled={regenLoading}>
                <Ionicons name="refresh" size={14} color={palette.muted} />
                <Text style={styles.regenText}>Régénérer</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.codeNote}>
              Les nouvelles demandes nécessitent votre approbation. Vous définissez le rôle.
            </Text>
          </View>
        </>
      )}

      {/* Pending Requests (admin only) */}
      {isAdmin && pendingRequests.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Demandes en attente</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingRequests.length}</Text>
            </View>
          </View>
          <View style={styles.list}>
            {pendingRequests.map((req, idx) => (
              <View
                key={req.id}
                style={[styles.memberRow, idx === pendingRequests.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{req.userEmail[0].toUpperCase()}</Text>
                </View>
                <Text style={[styles.memberEmail, { flex: 1 }]}>{req.userEmail}</Text>
                <TouchableOpacity
                  style={styles.rejectBtn}
                  onPress={() => handleRejectRequest(req)}
                >
                  <Ionicons name="close" size={16} color={palette.critical} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.approveBtn}
                  onPress={() => handleApproveRequest(req)}
                >
                  <Text style={styles.approveBtnText}>Approuver</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Weekly Target — admin only */}
      {isAdmin && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Objectif de production</Text>
          <View style={styles.targetCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.targetLabel}>Objectif hebdomadaire</Text>
              <Text style={styles.targetValue}>{weeklyTarget} unités / semaine</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => { setTargetInput(String(weeklyTarget)); setTargetModal(true); }}>
              <Text style={styles.editBtnText}>Modifier</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Data health check — admin only */}
      {isAdmin && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Vérification des données</Text>
          <View style={styles.targetCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.targetLabel}>Intégrité des chiffres</Text>
              <Text style={[styles.targetValue, { fontSize: 13, fontWeight: '400' }]}>
                Détecte les incohérences (ventes, achats, stock, investisseurs)
              </Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={runReconciliation}>
              <Text style={styles.editBtnText}>Vérifier</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <AppModal visible={checkModal} onClose={() => setCheckModal(false)} title="Vérification des données">
        {checkRunning && (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={palette.moss} />
            <Text style={[styles.modalSub, { marginTop: 12 }]}>Analyse en cours…</Text>
          </View>
        )}
        {!checkRunning && checkError && (
          <Text style={[styles.modalSub, { color: palette.critical }]}>{checkError}</Text>
        )}
        {!checkRunning && checkFindings && checkFindings.length === 0 && (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={40} color={palette.moss} />
            <Text style={[styles.modalTitle, { marginTop: 12, fontSize: 16 }]}>Tout est cohérent</Text>
            <Text style={styles.modalSub}>Aucune anomalie détectée dans les données.</Text>
          </View>
        )}
        {!checkRunning && checkFindings && checkFindings.length > 0 && (
          <ScrollView style={{ maxHeight: 420 }}>
            {checkFindings.map((f, i) => (
              <View
                key={i}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: f.severity === 'critical' ? palette.critical : palette.caution,
                  backgroundColor: palette.paper,
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: f.severity === 'critical' ? palette.critical : palette.caution, marginBottom: 4 }}>
                  {f.severity === 'critical' ? 'CRITIQUE' : 'À VÉRIFIER'}
                </Text>
                <Text style={{ fontSize: 14, color: palette.ink }}>{f.message}</Text>
              </View>
            ))}
          </ScrollView>
        )}
        <Button label="Fermer" variant="secondary" onPress={() => setCheckModal(false)} style={{ marginTop: 12 }} />
      </AppModal>

      {/* Approve role picker modal — works on web too */}
      <Modal visible={approveModal} transparent animationType="fade" onRequestClose={() => setApproveModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Approuver le membre</Text>
            <Text style={styles.modalSub}>{selectedRequest?.userEmail}</Text>
            <Text style={[styles.modalSub, { marginBottom: 16 }]}>Choisissez un rôle :</Text>
            {(['vendeur', 'employee', 'investor', 'inspecteur', 'admin'] as UserRole[]).map((role) => (
              <TouchableOpacity key={role} style={[styles.roleBtn, { borderColor: ROLE_COLORS[role] }]} onPress={() => confirmApprove(role)}>
                <Text style={[styles.roleBtnText, { color: ROLE_COLORS[role] }]}>{ROLE_LABELS[role]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setApproveModal(false)}>
              <Text style={styles.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Member options modal — role change + remove */}
      <Modal visible={memberModal} transparent animationType="fade" onRequestClose={() => setMemberModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{selectedMember?.email}</Text>
            <Text style={[styles.modalSub, { marginBottom: 4 }]}>
              Rôle actuel : {selectedMember ? ROLE_LABELS[selectedMember.role] : ''}
            </Text>
            <Text style={[styles.modalSub, { marginBottom: 12 }]}>Choisissez un nouveau rôle :</Text>
            {(['vendeur', 'employee', 'investor', 'inspecteur', 'admin'] as UserRole[]).map((role) => (
              <TouchableOpacity
                key={role}
                style={[styles.roleBtn, { borderColor: ROLE_COLORS[role] }]}
                onPress={async () => {
                  if (!selectedMember) return;
                  setMemberModal(false);
                  await updateMemberRole(selectedMember.userId, role);
                  await load();
                }}
              >
                <Text style={[styles.roleBtnText, { color: ROLE_COLORS[role] }]}>{ROLE_LABELS[role]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.roleBtn, { borderColor: palette.critical, marginTop: 8 }]}
              onPress={() => { setMemberModal(false); setRemoveConfirmModal(true); }}
            >
              <Text style={[styles.roleBtnText, { color: palette.critical }]}>Retirer de l'usine</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setMemberModal(false)}>
              <Text style={styles.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Remove member confirmation modal */}
      <Modal visible={removeConfirmModal} transparent animationType="fade" onRequestClose={() => setRemoveConfirmModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Retirer ce membre ?</Text>
            <Text style={[styles.modalSub, { marginBottom: 20 }]}>{selectedMember?.email}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setRemoveConfirmModal(false)}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, { backgroundColor: palette.critical }]}
                onPress={async () => {
                  if (!selectedMember) return;
                  setRemoveConfirmModal(false);
                  await removeMember(selectedMember.userId);
                  await load();
                  setSelectedMember(null);
                }}
              >
                <Text style={styles.modalSaveText}>Retirer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={targetModal} transparent animationType="fade" onRequestClose={() => setTargetModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Objectif hebdomadaire</Text>
            <Text style={styles.modalSub}>Objectif de production par semaine (unités)</Text>
            <TextInput
              style={styles.modalInput}
              value={targetInput}
              onChangeText={setTargetInput}
              keyboardType="number-pad"
              placeholder="ex: 1000"
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setTargetModal(false)}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={saveWeeklyTarget}>
                <Text style={styles.modalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Regen code confirm modal */}
      <Modal visible={regenConfirmModal} transparent animationType="fade" onRequestClose={() => setRegenConfirmModal(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="refresh" size={32} color={palette.moss} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Régénérer le code ?</Text>
            <Text style={styles.confirmSub}>L'ancien code sera invalidé immédiatement.</Text>
            <TouchableOpacity
              style={styles.confirmActionBtn}
              onPress={async () => {
                setRegenConfirmModal(false);
                const { error } = await doRegen();
                if (error) Alert.alert('Erreur', error);
              }}
            >
              <Text style={styles.confirmActionText}>Régénérer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setRegenConfirmModal(false)}>
              <Text style={styles.confirmCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Reject request confirm modal */}
      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Ionicons name="warning-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.confirmTitle}>Refuser la demande ?</Text>
            <Text style={styles.confirmSub}>{rejectTarget?.userEmail ?? ''}</Text>
            <TouchableOpacity
              style={styles.confirmDeleteBtn}
              onPress={async () => {
                if (!rejectTarget) return;
                setRejectTarget(null);
                const { error } = await rejectJoinRequest(rejectTarget.id);
                if (error) Alert.alert('Erreur', error);
                else await load();
              }}
            >
              <Text style={styles.confirmDeleteText}>Refuser</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setRejectTarget(null)}>
              <Text style={styles.confirmCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Members */}
      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Membres ({members.length})</Text>
      <View style={styles.list}>
        {members.map((member, idx) => (
          <TouchableOpacity
            key={member.memberId}
            style={[styles.memberRow, idx === members.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => handleMemberOptions(member)}
            disabled={member.isCurrentUser}
          >
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>{member.email[0].toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberEmail}>
                {member.email}{member.isCurrentUser ? ' (vous)' : ''}
              </Text>
            </View>
            <View style={[styles.rolePill, { backgroundColor: ROLE_COLORS[member.role] + '22' }]}>
              <Text style={[styles.rolePillText, { color: ROLE_COLORS[member.role] }]}>
                {ROLE_LABELS[member.role]}
              </Text>
            </View>
            {!member.isCurrentUser && <Ionicons name="chevron-forward" size={16} color={palette.muted} style={{ marginLeft: 6 }} />}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  splash: { flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: 16, paddingBottom: 50 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backText: { color: palette.moss, fontSize: 16, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '700', color: palette.ink, marginBottom: 4 },
  factoryName: { fontSize: 15, color: palette.muted, marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 },
  badge: { backgroundColor: palette.caution, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: palette.white, fontSize: 11, fontWeight: '700' },
  codeCard: { backgroundColor: palette.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: palette.line },
  codeLabel: { fontSize: 13, color: palette.muted, marginBottom: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  codeText: { fontSize: 28, fontWeight: '800', color: palette.ink, letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.mossSoft, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  copyText: { color: palette.moss, fontWeight: '600', fontSize: 14 },
  barTrack: { height: 4, backgroundColor: palette.line, borderRadius: 2, marginBottom: 8, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  timerText: { fontSize: 12, fontWeight: '600' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  regenText: { fontSize: 12, color: palette.muted, fontWeight: '500' },
  codeNote: { fontSize: 12, color: palette.muted, lineHeight: 17 },
  list: { backgroundColor: palette.card, borderRadius: 16, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderColor: palette.line, gap: 10 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 16, fontWeight: '700', color: palette.muted },
  memberEmail: { fontSize: 14, color: palette.ink, fontWeight: '500' },
  rolePill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  rolePillText: { fontSize: 12, fontWeight: '700' },
  approveBtn: { backgroundColor: palette.moss, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  approveBtnText: { color: palette.white, fontSize: 13, fontWeight: '700' },
  rejectBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.criticalSoft, alignItems: 'center', justifyContent: 'center' },
  targetCard: { backgroundColor: palette.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center' },
  targetLabel: { fontSize: 12, color: palette.muted, marginBottom: 4 },
  targetValue: { fontSize: 16, fontWeight: '700', color: palette.ink },
  editBtn: { backgroundColor: palette.mossSoft, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { color: palette.moss, fontWeight: '700', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: palette.card, borderRadius: 16, padding: 24, width: '100%' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: 4 },
  modalSub: { fontSize: 13, color: palette.muted, marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 12, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.line, alignItems: 'center' },
  modalCancelText: { color: palette.muted, fontWeight: '600' },
  modalSave: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: palette.moss, alignItems: 'center' },
  modalSaveText: { color: palette.white, fontWeight: '700' },
  roleBtn: { borderWidth: 1.5, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  roleBtnText: { fontWeight: '700', fontSize: 15 },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24,
  },
  confirmBox: { backgroundColor: palette.card, borderRadius: 16, padding: 24 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, textAlign: 'center', marginBottom: 6 },
  confirmSub: { fontSize: 14, color: palette.muted, textAlign: 'center', marginBottom: 20 },
  confirmActionBtn: {
    backgroundColor: palette.moss, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  confirmActionText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  confirmDeleteBtn: {
    backgroundColor: palette.critical, borderRadius: 12, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  confirmDeleteText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  confirmCancelBtn: {
    borderRadius: 12, height: 52, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmCancelText: { fontSize: 16, color: palette.muted, fontWeight: '600' },
});
