import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Animated, TextInput } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types';
import { useAuth, UserRole, FactoryMembership, ROLE_LABELS, makeRoleColors } from '../../context/AuthContext';
import { getProfile, UserProfile } from '../../store/profile';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import { toFrench } from '../../utils/errors';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { AppModal, Button, ConfirmDialog, Text } from '../../components/ui';

const DELETE_CONFIRM_WORD = 'SUPPRIMER';

type PlusNav = NativeStackNavigationProp<RootStackParamList>;

type MenuItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: keyof RootStackParamList;
  hint?: string;
  roles: UserRole[];
};

type Section = { title: string; items: MenuItem[] };

// Reorganized from the original 5 sections (Finance / Gestion / Produits /
// Analyses / Usine) into 3 meaningful buckets — Clients, Fournisseurs,
// Produits — plus one Administration catch-all for what doesn't fit any of
// the three, matching the same simplification pass already done on Patron.
// Créances is gone as its own menu entry: its aging/mark-paid/partial-
// payment functionality was ported directly into the Clients screen's own
// "Créances" tab (screens/Clients/index.tsx) instead, so seeing who owes
// what — and acting on it — no longer needs a separate screen. Notifications
// is dropped entirely for now (no other screen links to it either, so this
// makes the route fully unreachable via UI, on purpose).
//
// Role rework (db/update27.sql, "manager" replacing "employee"): auditing
// this list against the actual RLS grants each role now has (see
// context/AuthContext.tsx's UserRole doc comment) surfaced real, pre-
// existing gaps, not just a rename — 'employee' already had RLS write
// access to suppliers/purchases, expenses, and documents, and (oddest of
// all) had never been able to reach Bilan/Reports at all despite reading
// every other operational screen — the menu here was simply stricter than
// the database ever was. Fixed alongside the rename rather than left as a
// second, separate bug: manager gets every route admin does except
// Paramètres (team/factory ownership — see the UserRole doc comment for
// why that one stays admin-only). investor loses Claude specifically —
// its underlying getBusinessSnapshot() reads every operational table
// directly, which would silently defeat the whole point of scoping
// investor's RLS access down to their own investment + headline numbers.
const ALL_SECTIONS: Section[] = [
  {
    title: 'Clients',
    items: [
      { label: 'Ventes', icon: 'time-outline', route: 'SalesHistory', hint: 'Historique des ventes', roles: ['admin', 'manager', 'vendeur'] },
      { label: 'Clients', icon: 'people', route: 'Clients', hint: 'Annuaire & créances', roles: ['admin', 'manager', 'vendeur'] },
      { label: 'Commandes clients', icon: 'clipboard-outline', route: 'CustomerOrders', hint: 'Suivre les commandes en cours', roles: ['admin', 'manager'] },
    ],
  },
  {
    title: 'Fournisseurs',
    items: [
      { label: 'Fournisseurs', icon: 'cube-outline', route: 'Suppliers', hint: 'Fournisseurs & historique achats', roles: ['admin', 'manager'] },
      { label: 'Investisseurs', icon: 'trending-up', route: 'Investors', hint: 'Capital & versements', roles: ['admin', 'manager', 'investor'] },
    ],
  },
  {
    title: 'Produits',
    items: [
      { label: 'Saveurs', icon: 'color-palette', route: 'Flavors', hint: 'Créer & gérer les saveurs', roles: ['admin', 'manager'] },
      { label: 'Lots', icon: 'layers', route: 'Bulks', hint: 'Créer & gérer les lots', roles: ['admin', 'manager'] },
      { label: 'Machines', icon: 'hardware-chip-outline', route: 'Machines', hint: 'Équipement, capacité & statut', roles: ['admin', 'manager'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Dépenses', icon: 'receipt-outline', route: 'Expenses', hint: 'Loyer, salaires, charges...', roles: ['admin', 'manager'] },
      { label: 'Documents', icon: 'document-text', route: 'Documents', hint: 'Contrats & licences', roles: ['admin', 'manager', 'inspecteur'] },
      { label: 'Bilan', icon: 'bar-chart', route: 'Reports', hint: 'Statistiques & tendances', roles: ['admin', 'manager', 'investor', 'inspecteur'] },
      { label: 'Claude', icon: 'bulb', route: 'Coach', hint: 'Bilan · Goulot · Action prioritaire', roles: ['admin', 'manager'] },
      { label: 'Paramètres', icon: 'settings', route: 'FactorySettings', hint: 'Membres, invitations & rôles', roles: ['admin'] },
    ],
  },
];

export default function PlusScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const ROLE_COLORS = makeRoleColors(palette);
  const navigation = useNavigation<PlusNav>();
  const insets = useSafeAreaInsets();
  const { membership, allMemberships, switchFactory, signOut, user } = useAuth();
  const role = membership?.role ?? 'manager';

  const [profile, setProfile] = useState<UserProfile>({
    displayName: '', avatarUri: null, preferredLanguage: null, voiceAutoplay: false,
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageOpacity = useRef(new Animated.Value(0)).current;
  const prevAvatarUri = useRef<string | null>(null);
  const [logoutModal, setLogoutModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    // withTimeout — without it, a hung request (not a returned error) would
    // leave `deleting` true forever with no way for the user to back out of
    // this specific modal short of force-closing the app. See lib/withTimeout.ts.
    let error;
    try {
      ({ error } = await withTimeout(supabase.rpc('delete_my_account')));
    } catch {
      setDeleting(false);
      setDeleteError('Connexion trop lente. Vérifiez votre connexion et réessayez.');
      return;
    }
    if (error) {
      setDeleting(false);
      // Postgres RAISE EXCEPTION surfaces as SQLSTATE P0001 — that message
      // is already real French copy written for the user (see
      // db/update16.sql); anything else goes through toFrench() the same
      // way every other Supabase error in this app already does.
      setDeleteError((error as { code?: string }).code === 'P0001' ? error.message : toFrench(error.message));
      return;
    }
    // The account (and its session) no longer exists server-side — clear
    // the local session the same way a normal logout does.
    await signOut();
  }

  // Reset image state when the avatar URI actually changes
  useEffect(() => {
    if (profile.avatarUri !== prevAvatarUri.current) {
      prevAvatarUri.current = profile.avatarUri;
      setImageLoaded(false);
      imageOpacity.setValue(0);
    }
  }, [profile.avatarUri, imageOpacity]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      setProfileLoaded(false);
      getProfile(user.id).then((p) => {
        setProfile(p);
        setProfileLoaded(true);
      });
    }, [user?.id])
  );

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(imageOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  const initials = ((profile.displayName || user?.email || '?')[0]).toUpperCase();
  const showImage = profileLoaded && !!profile.avatarUri;

  const filteredSections = ALL_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.content}>
      {/* Profile card */}
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() => navigation.navigate('Profile')}
        activeOpacity={0.75}
      >
        <View style={styles.profileLeft}>
          {/* Avatar: always show initials as base; fade image in on top once loaded */}
          <View style={styles.avatarContainer}>
            <View style={[StyleSheet.absoluteFill, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
            {showImage && (
              <Animated.Image
                key={`avatar-${user?.id}`}
                source={{ uri: profile.avatarUri! }}
                style={[StyleSheet.absoluteFill, styles.avatarImage, { opacity: imageOpacity }]}
                onLoad={handleImageLoad}
              />
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile.displayName || user?.email || 'Mon profil'}
            </Text>
            <View style={styles.profileMeta}>
              <View style={[styles.rolePill, { backgroundColor: ROLE_COLORS[role] + '22' }]}>
                <Text style={[styles.rolePillText, { color: ROLE_COLORS[role] }]}>
                  {ROLE_LABELS[role]}
                </Text>
              </View>
              <Text style={styles.factoryLabel} numberOfLines={1}>
                · {membership?.factoryName ?? 'Mon usine'}
              </Text>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.muted} />
      </TouchableOpacity>

      {filteredSections.map((section) => (
        <View key={section.title}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.list}>
            {section.items.map((item, idx) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.row, idx === section.items.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => navigation.navigate(item.route as 'Documents')}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={item.icon} size={20} color={palette.ink} />
                </View>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={palette.muted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Factory switcher */}
      {allMemberships.length > 1 && (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.sectionTitle}>Changer d'usine</Text>
          <View style={styles.list}>
            {allMemberships.map((m: FactoryMembership, idx: number) => (
              <TouchableOpacity
                key={m.factoryId}
                style={[styles.row, idx === allMemberships.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => switchFactory(m.factoryId)}
              >
                <View style={[styles.iconWrap, membership?.factoryId === m.factoryId && { backgroundColor: palette.mossSoft }]}>
                  <Ionicons name="business" size={20} color={membership?.factoryId === m.factoryId ? palette.moss : palette.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{m.factoryName}</Text>
                  <Text style={styles.rowHint}>{ROLE_LABELS[m.role]}</Text>
                </View>
                {membership?.factoryId === m.factoryId && <Ionicons name="checkmark-circle" size={20} color={palette.moss} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <ConfirmDialog
        visible={logoutModal}
        onClose={() => setLogoutModal(false)}
        onConfirm={signOut}
        title="Se déconnecter ?"
        message="Vous devrez vous reconnecter pour accéder à l'application."
        confirmLabel="Se déconnecter"
        icon="log-out-outline"
        tone="danger"
      />

      {/* Logout */}
      <View style={styles.dangerSection}>
        <Text style={styles.dangerTitle}>Compte</Text>
        <TouchableOpacity style={styles.logoutRow} onPress={() => setLogoutModal(true)}>
          <View style={[styles.iconWrap, { backgroundColor: palette.criticalSoft }]}>
            <Ionicons name="log-out-outline" size={22} color={palette.critical} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: palette.critical }]}>Se déconnecter</Text>
            <Text style={[styles.rowHint, { color: palette.critical }]}>{membership?.role === 'admin' ? membership?.factoryName : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.critical} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.logoutRow, { marginTop: 10 }]}
          onPress={() => { setDeleteConfirmText(''); setDeleteError(null); setDeleteModal(true); }}
        >
          <View style={[styles.iconWrap, { backgroundColor: palette.criticalSoft }]}>
            <Ionicons name="trash-outline" size={22} color={palette.critical} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: palette.critical }]}>Supprimer mon compte</Text>
            <Text style={[styles.rowHint, { color: palette.critical }]}>Action définitive</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.critical} />
        </TouchableOpacity>
      </View>

      {/* Delete account confirmation — deliberately higher friction than
          logout: typing the confirmation word, not just a Yes/No tap, since
          this is irreversible and (for a sole admin) takes an entire
          factory's data with it. */}
      <AppModal visible={deleteModal} onClose={() => setDeleteModal(false)} title="Supprimer votre compte ?">
        <Text style={styles.modalSub}>
          Cette action est définitive. Si vous êtes administrateur d'une usine où vous êtes seul, l'usine et toutes ses données (ventes, stock, dépenses…) seront supprimées avec votre compte.
        </Text>
        <Text style={[styles.modalSub, { marginTop: 4 }]}>
          Tapez <Text style={{ fontWeight: '800', color: palette.ink }}>{DELETE_CONFIRM_WORD}</Text> pour confirmer.
        </Text>
        <TextInput
          style={styles.deleteInput}
          value={deleteConfirmText}
          onChangeText={setDeleteConfirmText}
          placeholder={DELETE_CONFIRM_WORD}
          placeholderTextColor={palette.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
        />
        {!!deleteError && <Text style={styles.deleteErrorText}>{deleteError}</Text>}
        <Button
          label={deleting ? 'Suppression…' : 'Supprimer définitivement'}
          variant="danger"
          fullWidth
          loading={deleting}
          disabled={deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRM_WORD || deleting}
          onPress={handleDeleteAccount}
          style={{ marginTop: 12 }}
        />
        <Button
          label="Annuler"
          variant="ghost"
          fullWidth
          disabled={deleting}
          onPress={() => setDeleteModal(false)}
          style={{ marginTop: 8 }}
        />
      </AppModal>
    </ScrollView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  content: { padding: 16, paddingBottom: 40 },
  // No border — palette.card is deliberately a distinct fill from
  // palette.paper now (not just a shadow-carrying near-duplicate), so the
  // surface itself reads as "raised" without needing an outline stacked on
  // top of it. A bordered box announces itself as a canvas; a plain
  // color-shift doesn't.
  profileCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: palette.card, borderRadius: 16, padding: 14,
    marginBottom: 20,
  },
  profileLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarContainer: {
    width: 52, height: 52, borderRadius: 26,
    overflow: 'hidden', marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: palette.moss,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { borderRadius: 26 },
  avatarInitials: { fontSize: 20, fontWeight: '800', color: palette.white },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: palette.ink, marginBottom: 4 },
  profileMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  rolePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  rolePillText: { fontSize: 11, fontWeight: '700' },
  factoryLabel: { fontSize: 12, color: palette.muted, flex: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 16 },
  list: { backgroundColor: palette.card, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: palette.line },
  // Neutral by default — color is spent on real signals elsewhere (the
  // factory switcher's selected state, the danger section), not stamped on
  // every single menu icon out of habit. A wall of green icons made none of
  // them mean anything; a quiet gray icon here makes the moss accent
  // actually stand out where it's still used.
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: palette.line, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rowLabel: { fontSize: 16, color: palette.ink, fontWeight: '500', flex: 1 },
  rowHint: { fontSize: 12, color: palette.muted, marginTop: 1 },
  dangerSection: { marginTop: 28 },
  dangerTitle: { fontSize: 12, fontWeight: '700', color: palette.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  // No special background at all, and no border — the red icon-wrap and
  // red label text (set inline where this style is used) already carry
  // the "destructive" signal on their own; tinting the whole row too would
  // just be decorating a signal that's already there.
  logoutRow: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: palette.card, borderRadius: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: palette.card, borderRadius: 16, padding: 24, width: '100%' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: 6 },
  modalSub: { fontSize: 14, color: palette.muted, marginBottom: 20 },
  deleteInput: {
    borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 14,
    fontSize: 16, fontWeight: '700', color: palette.ink, backgroundColor: palette.paper,
    marginBottom: 12, letterSpacing: 1,
  },
  deleteErrorText: { fontSize: 13, color: palette.critical, marginBottom: 12, lineHeight: 18 },
  modalLogout: { backgroundColor: palette.critical, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  modalLogoutText: { color: palette.white, fontWeight: '700', fontSize: 15 },
  modalCancel: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCancelText: { color: palette.muted, fontWeight: '600', fontSize: 15 },
});
