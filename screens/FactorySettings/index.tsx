import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Clipboard, RefreshControl, TextInput, Platform, Share } from 'react-native';
import { getWeeklyTarget, setWeeklyTarget } from '../../store/weeklyTarget';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, UserRole, MemberDisplay, JoinRequestDisplay, ROLE_LABELS, makeRoleColors } from '../../context/AuthContext';
import { buildInviteLink } from '../../lib/inviteLink';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';
import { AppModal, Button, ConfirmDialog, AnimatedProgressBar, switchModal, Text } from '../../components/ui';

type ReconciliationFinding = {
  severity: 'critical' | 'warning';
  check_name: string;
  entity_type: string;
  entity_id: string | null;
  message: string;
};

// Raised from 60s (found while adding the "Partager" link button below) —
// a code that rotates every 60 seconds is unusable for actual human
// sharing: by the time an admin copies it into WhatsApp and the recipient
// opens the message, it's very likely already stale. 15 minutes is still a
// short window (an old screenshot/forwarded message goes dead reasonably
// soon), just a realistically usable one — the per-IP rate limit on the
// lookup-factory edge function (db/update7.sql's invite_lookup_log) is the
// actual brute-force defense, not this rotation.
const CODE_TTL = 900;

function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}min ${s}s` : `${m}min`;
}

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

  // Modernized invite flow: a real link (opens the PWA directly with the
  // code pre-filled — see lib/inviteLink.ts) shared through the native
  // share sheet, instead of asking someone to manually copy-paste an
  // 8-character code into a message by hand. Approval still happens the
  // same way (isAdmin picks the role once the request lands below) —
  // this only changes how the code physically gets to the new member.
  async function shareInviteLink() {
    if (!inviteCode) return;
    const link = buildInviteLink(inviteCode);
    try {
      await Share.share({
        message: `Rejoignez ${membership?.factoryName ?? 'notre usine'} sur Orny : ${link}`,
        url: link,
      });
    } catch {}
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
    <View style={styles.container}>
      {/* Pinned header — was previously the first row of the ScrollView's
          own content, so it scrolled away with everything else, unlike
          every other custom-header screen (Machines, Profile,
          Notifications), which all pin their header outside the scroll. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
          <Ionicons name="chevron-back" size={24} color={palette.ink} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Paramètres usine</Text>
          <Text style={styles.headerFactoryName}>{membership?.factoryName}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.moss} />}
      >

      {/* Invite Code — admin only */}
      {isAdmin && (
        <>
          <Text style={styles.sectionTitle}>Code d'invitation</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Partagez un lien pour inviter des membres</Text>

            {regenLoading
              ? <ActivityIndicator color={palette.moss} style={{ marginVertical: 8 }} />
              : <Text style={styles.codeText}>{inviteCode ?? '—'}</Text>}

            <TouchableOpacity style={styles.shareBtn} onPress={shareInviteLink} disabled={regenLoading || !inviteCode}>
              <Ionicons name="share-social-outline" size={18} color={palette.white} />
              <Text style={styles.shareBtnText}>Partager le lien</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.copyBtn} onPress={copyInviteCode} disabled={regenLoading || !inviteCode}>
              <Ionicons name="copy-outline" size={16} color={palette.moss} />
              <Text style={styles.copyText}>Copier le code seul</Text>
            </TouchableOpacity>

            <AnimatedProgressBar
              progress={pct * 100}
              color={barColor}
              duration={950}
              style={{ marginBottom: 8, marginTop: 14 }}
            />
            <View style={styles.timerRow}>
              <Text style={[styles.timerText, { color: barColor }]}>
                Nouveau code dans {formatCountdown(countdown)}
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

      {/* Approve role picker */}
      <AppModal visible={approveModal} onClose={() => setApproveModal(false)} title="Approuver le membre">
        <Text style={styles.modalSub}>{selectedRequest?.userEmail}</Text>
        <Text style={[styles.modalSub, { marginBottom: 16 }]}>Choisissez un rôle :</Text>
        {(['vendeur', 'manager', 'investor', 'inspecteur', 'admin'] as UserRole[]).map((role) => (
          <TouchableOpacity key={role} style={[styles.roleBtn, { borderColor: ROLE_COLORS[role] }]} onPress={() => confirmApprove(role)}>
            <Text style={[styles.roleBtnText, { color: ROLE_COLORS[role] }]}>{ROLE_LABELS[role]}</Text>
          </TouchableOpacity>
        ))}
      </AppModal>

      {/* Member options — role change + remove */}
      <AppModal visible={memberModal} onClose={() => setMemberModal(false)} title={selectedMember?.email}>
        <Text style={[styles.modalSub, { marginBottom: 4 }]}>
          Rôle actuel : {selectedMember ? ROLE_LABELS[selectedMember.role] : ''}
        </Text>
        <Text style={[styles.modalSub, { marginBottom: 12 }]}>Choisissez un nouveau rôle :</Text>
        {(['vendeur', 'manager', 'investor', 'inspecteur', 'admin'] as UserRole[]).map((role) => (
          <TouchableOpacity
            key={role}
            style={[styles.roleBtn, { borderColor: ROLE_COLORS[role] }]}
            onPress={async () => {
              if (!selectedMember) return;
              setMemberModal(false);
              // Returns { error }, like removeMember above — was previously
              // discarded unchecked, so a real rejection (e.g. the max-one-
              // manager rule) silently left the role unchanged with no
              // explanation.
              const { error } = await updateMemberRole(selectedMember.userId, role);
              if (error) { Alert.alert('Erreur', error); return; }
              await load();
            }}
          >
            <Text style={[styles.roleBtnText, { color: ROLE_COLORS[role] }]}>{ROLE_LABELS[role]}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.roleBtn, { borderColor: palette.critical, marginTop: 8 }]}
          onPress={() => switchModal(() => setMemberModal(false), () => setRemoveConfirmModal(true))}
        >
          <Text style={[styles.roleBtnText, { color: palette.critical }]}>Retirer de l'usine</Text>
        </TouchableOpacity>
      </AppModal>

      {/* Remove member confirmation */}
      <ConfirmDialog
        visible={removeConfirmModal}
        onClose={() => setRemoveConfirmModal(false)}
        onConfirm={async () => {
          if (!selectedMember) return;
          setRemoveConfirmModal(false);
          // removeMember returns { error }, like doRegen/rejectJoinRequest
          // below — it doesn't throw. This was previously discarded
          // unchecked, so a real rejection (e.g. the sole-admin guard)
          // silently did nothing instead of telling the user why.
          const { error } = await removeMember(selectedMember.userId);
          if (error) { Alert.alert('Erreur', error); return; }
          await load();
          setSelectedMember(null);
        }}
        title="Retirer ce membre ?"
        message={selectedMember?.email}
        confirmLabel="Retirer"
        icon="person-remove-outline"
        tone="danger"
      />

      {/* Weekly target */}
      <AppModal visible={targetModal} onClose={() => setTargetModal(false)} title="Objectif hebdomadaire">
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalSub}>Objectif de production par semaine (unités)</Text>
          <TextInput
            style={styles.modalInput}
            value={targetInput}
            onChangeText={setTargetInput}
            keyboardType="number-pad"
            autoFocus
          />
          <View style={styles.modalBtns}>
            <Button label="Annuler" variant="ghost" onPress={() => setTargetModal(false)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={saveWeeklyTarget} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </AppModal>

      {/* Regen code confirm */}
      <ConfirmDialog
        visible={regenConfirmModal}
        onClose={() => setRegenConfirmModal(false)}
        onConfirm={async () => {
          setRegenConfirmModal(false);
          const { error } = await doRegen();
          if (error) Alert.alert('Erreur', error);
        }}
        title="Régénérer le code ?"
        message="L'ancien code sera invalidé immédiatement."
        confirmLabel="Régénérer"
        icon="refresh"
      />

      {/* Reject request confirm */}
      <ConfirmDialog
        visible={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={async () => {
          if (!rejectTarget) return;
          setRejectTarget(null);
          const { error } = await rejectJoinRequest(rejectTarget.id);
          if (error) Alert.alert('Erreur', error);
          else await load();
        }}
        title="Refuser la demande ?"
        message={rejectTarget?.userEmail ?? ''}
        confirmLabel="Refuser"
        icon="warning-outline"
        tone="danger"
      />

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
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  splash: { flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: 16, paddingBottom: 50 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: palette.card, borderBottomWidth: 1, borderColor: palette.line,
  },
  headerBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.ink },
  headerFactoryName: { fontSize: 12, color: palette.muted, marginTop: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 },
  badge: { backgroundColor: palette.caution, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: palette.white, fontSize: 11, fontWeight: '700' },
  codeCard: { backgroundColor: palette.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: palette.line },
  codeLabel: { fontSize: 13, color: palette.muted, marginBottom: 12 },
  codeText: { fontSize: 24, fontWeight: '800', color: palette.ink, letterSpacing: 3, textAlign: 'center', marginBottom: 14 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.moss, borderRadius: 10, paddingVertical: 12, marginBottom: 8,
  },
  shareBtnText: { color: palette.white, fontWeight: '700', fontSize: 15 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  copyText: { color: palette.muted, fontWeight: '600', fontSize: 13 },
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
  modalTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: 4 },
  modalSub: { fontSize: 13, color: palette.muted, marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 12, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  roleBtn: { borderWidth: 1.5, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  roleBtnText: { fontWeight: '700', fontSize: 15 },
});
