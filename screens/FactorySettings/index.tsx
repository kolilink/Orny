import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Clipboard, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, UserRole, MemberDisplay, JoinRequestDisplay } from '../../context/AuthContext';

const C = {
  primary: '#1D9E75', bg: '#F8F8F6', card: '#FFFFFF',
  muted: '#6B6B66', border: '#E8E8E4', red: '#E24B4A', orange: '#EF9F27',
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  employee: 'Employé',
  investor: 'Investisseur',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#1D9E75',
  employee: '#5B8AF5',
  investor: '#EF9F27',
};

const CODE_TTL = 60;

export default function FactorySettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    membership,
    getMembers, updateMemberRole, removeMember, regenerateInviteCode,
    getPendingRequests, approveJoinRequest, rejectJoinRequest,
  } = useAuth();

  const [members, setMembers] = useState<MemberDisplay[]>([]);
  const [pendingRequests, setPendingRequests] = useState<JoinRequestDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(CODE_TTL);
  const [regenLoading, setRegenLoading] = useState(false);

  const regenRef = useRef(regenerateInviteCode);
  regenRef.current = regenerateInviteCode;

  const isAdmin = membership?.role === 'admin';

  async function load() {
    const [mems, reqs] = await Promise.all([
      getMembers(),
      isAdmin ? getPendingRequests() : Promise.resolve([]),
    ]);
    setMembers(mems);
    setPendingRequests(reqs);
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
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setRegenLoading(true);
          regenRef.current().then(() => setRegenLoading(false)).catch(console.error);
          return CODE_TTL;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setCountdown(CODE_TTL);
  }, [membership?.inviteCode]);

  async function handleManualRegen() {
    Alert.alert(
      'Régénérer le code ?',
      'L\'ancien code sera invalidé immédiatement.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Régénérer', onPress: async () => {
            setRegenLoading(true);
            const { error } = await regenerateInviteCode();
            setRegenLoading(false);
            if (error) Alert.alert('Erreur', error);
          },
        },
      ]
    );
  }

  function copyInviteCode() {
    if (!membership) return;
    Clipboard.setString(membership.inviteCode);
    Alert.alert('Copié !', `Code d'invitation : ${membership.inviteCode}`);
  }

  function handleMemberOptions(member: MemberDisplay) {
    if (member.isCurrentUser) return;
    Alert.alert(member.email, `Rôle actuel : ${ROLE_LABELS[member.role]}`, [
      {
        text: 'Changer le rôle', onPress: () => {
          Alert.alert('Nouveau rôle', '', [
            { text: 'Employé', onPress: async () => { await updateMemberRole(member.userId, 'employee'); await load(); } },
            { text: 'Investisseur', onPress: async () => { await updateMemberRole(member.userId, 'investor'); await load(); } },
            { text: 'Administrateur', onPress: async () => { await updateMemberRole(member.userId, 'admin'); await load(); } },
            { text: 'Annuler', style: 'cancel' },
          ]);
        },
      },
      {
        text: 'Retirer de l\'usine', style: 'destructive', onPress: async () => {
          Alert.alert('Retirer ce membre ?', member.email, [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Retirer', style: 'destructive', onPress: async () => { await removeMember(member.userId); await load(); } },
          ]);
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  function handleApproveRequest(req: JoinRequestDisplay) {
    Alert.alert(`Approuver ${req.userEmail}`, 'Choisissez un rôle pour ce membre :', [
      {
        text: 'Employé', onPress: async () => {
          const { error } = await approveJoinRequest(req.id, req.userId, 'employee');
          if (error) Alert.alert('Erreur', error);
          else await load();
        },
      },
      {
        text: 'Investisseur', onPress: async () => {
          const { error } = await approveJoinRequest(req.id, req.userId, 'investor');
          if (error) Alert.alert('Erreur', error);
          else await load();
        },
      },
      {
        text: 'Administrateur', onPress: async () => {
          const { error } = await approveJoinRequest(req.id, req.userId, 'admin');
          if (error) Alert.alert('Erreur', error);
          else await load();
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  function handleRejectRequest(req: JoinRequestDisplay) {
    Alert.alert('Refuser la demande ?', req.userEmail, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Refuser', style: 'destructive', onPress: async () => {
          const { error } = await rejectJoinRequest(req.id);
          if (error) Alert.alert('Erreur', error);
          else await load();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  const pct = countdown / CODE_TTL;
  const barColor = pct > 0.4 ? C.primary : pct > 0.2 ? C.orange : C.red;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color={C.primary} />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Paramètres usine</Text>
      <Text style={styles.factoryName}>{membership?.factoryName}</Text>

      {/* Invite Code */}
      <Text style={styles.sectionTitle}>Code d'invitation</Text>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Partagez ce code pour inviter des membres</Text>

        <View style={styles.codeRow}>
          {regenLoading
            ? <ActivityIndicator color={C.primary} style={{ flex: 1 }} />
            : <Text style={styles.codeText}>{membership?.inviteCode}</Text>}
          <TouchableOpacity style={styles.copyBtn} onPress={copyInviteCode} disabled={regenLoading}>
            <Ionicons name="copy-outline" size={18} color={C.primary} />
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
            <Ionicons name="refresh" size={14} color={C.muted} />
            <Text style={styles.regenText}>Régénérer</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.codeNote}>
          Les nouvelles demandes nécessitent votre approbation. Vous définissez le rôle.
        </Text>
      </View>

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
                  <Ionicons name="close" size={16} color={C.red} />
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
            {!member.isCurrentUser && <Ionicons name="chevron-forward" size={16} color="#BABAB6" style={{ marginLeft: 6 }} />}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 50 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backText: { color: C.primary, fontSize: 16, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '700', color: '#1A1A18', marginBottom: 4 },
  factoryName: { fontSize: 15, color: C.muted, marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 },
  badge: { backgroundColor: C.orange, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  codeCard: { backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  codeLabel: { fontSize: 13, color: C.muted, marginBottom: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  codeText: { fontSize: 28, fontWeight: '800', color: '#1A1A18', letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E8F6F0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  copyText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  barTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, marginBottom: 8, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  timerText: { fontSize: 12, fontWeight: '600' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  regenText: { fontSize: 12, color: C.muted, fontWeight: '500' },
  codeNote: { fontSize: 12, color: C.muted, lineHeight: 17 },
  list: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderColor: '#F0F0EE', gap: 10 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F0EE', alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 16, fontWeight: '700', color: C.muted },
  memberEmail: { fontSize: 14, color: '#1A1A18', fontWeight: '500' },
  rolePill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  rolePillText: { fontSize: 12, fontWeight: '700' },
  approveBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  approveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  rejectBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFE8E8', alignItems: 'center', justifyContent: 'center' },
});
