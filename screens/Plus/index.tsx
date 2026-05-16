import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types';
import { useAuth, UserRole, FactoryMembership } from '../../context/AuthContext';
import { getProfile, UserProfile } from '../../store/profile';

type PlusNav = NativeStackNavigationProp<RootStackParamList>;

const C = {
  primary: '#1D9E75', red: '#E24B4A', bg: '#F8F8F6',
  card: '#FFFFFF', text: '#1A1A18', muted: '#6B6B66', border: '#E8E8E4',
};

type MenuItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: keyof RootStackParamList;
  hint?: string;
  roles: UserRole[];
};

type Section = { title: string; items: MenuItem[] };

const ALL_SECTIONS: Section[] = [
  {
    title: 'Finance',
    items: [
      { label: 'Dépenses', icon: 'receipt-outline', route: 'Expenses', hint: 'Loyer, salaires, charges...', roles: ['admin', 'employee'] },
      { label: 'Créances', icon: 'alarm-outline', route: 'Creances', hint: 'Clients à relancer', roles: ['admin', 'employee'] },
      { label: 'Investisseurs', icon: 'trending-up', route: 'Investors', hint: 'Capital & versements', roles: ['admin', 'investor'] },
    ],
  },
  {
    title: 'Gestion',
    items: [
      { label: 'Commandes clients', icon: 'clipboard-outline', route: 'CustomerOrders', hint: 'Suivre les commandes en cours', roles: ['admin', 'employee'] },
      { label: 'Fournisseurs & Achats', icon: 'cube-outline', route: 'Suppliers', hint: 'Fournisseurs & historique achats', roles: ['admin', 'employee'] },
      { label: 'Clients', icon: 'people', route: 'Clients', hint: 'Annuaire clients', roles: ['admin', 'employee'] },
      { label: 'Documents', icon: 'document-text', route: 'Documents', hint: 'Contrats & licences', roles: ['admin'] },
    ],
  },
  {
    title: 'Produits',
    items: [
      { label: 'Saveurs', icon: 'color-palette', route: 'Flavors', hint: 'Créer & gérer les saveurs', roles: ['admin', 'employee'] },
      { label: 'Vrac / Lots', icon: 'layers', route: 'Bulks', hint: 'Créer & gérer les lots', roles: ['admin', 'employee'] },
    ],
  },
  {
    title: 'Analyses',
    items: [
      { label: 'Sol Coach IA', icon: 'bulb', route: 'Coach', hint: 'Bilan · Goulot · Action prioritaire', roles: ['admin', 'employee', 'investor'] },
      { label: 'Rapports', icon: 'bar-chart', route: 'Reports', hint: 'Statistiques & tendances', roles: ['admin', 'investor'] },
    ],
  },
  {
    title: 'Usine',
    items: [
      { label: 'Paramètres usine', icon: 'settings', route: 'FactorySettings', hint: 'Membres, invitations & rôles', roles: ['admin'] },
    ],
  },
];

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

export default function PlusScreen() {
  const navigation = useNavigation<PlusNav>();
  const insets = useSafeAreaInsets();
  const { membership, allMemberships, switchFactory, signOut, user } = useAuth();
  const role = membership?.role ?? 'employee';
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', avatarUri: null });

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      getProfile(user.id).then(setProfile);
    }, [user?.id])
  );

  const filteredSections = ALL_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);

  function handleSignOut() {
    Alert.alert('Se déconnecter ?', 'Vous devrez vous reconnecter pour accéder à l\'application.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.content}>
      {/* Profile card */}
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() => navigation.navigate('Profile')}
        activeOpacity={0.75}
      >
        <View style={styles.profileLeft}>
          {profile.avatarUri ? (
            <Image source={{ uri: profile.avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>
                {(profile.displayName || user?.email || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
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
        <Ionicons name="chevron-forward" size={18} color="#BABAB6" />
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
                  <Ionicons name={item.icon} size={22} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  {!!item.hint && <Text style={styles.rowHint}>{item.hint}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#BABAB6" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Factory switcher — shown only when user belongs to multiple factories */}
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
                <View style={[styles.iconWrap, membership?.factoryId === m.factoryId && { backgroundColor: '#E8F6F0' }]}>
                  <Ionicons name="business" size={20} color={membership?.factoryId === m.factoryId ? C.primary : C.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{m.factoryName}</Text>
                  <Text style={styles.rowHint}>{ROLE_LABELS[m.role]}</Text>
                </View>
                {membership?.factoryId === m.factoryId && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Logout */}
      <View style={styles.dangerSection}>
        <Text style={styles.dangerTitle}>Compte</Text>
        <TouchableOpacity style={styles.logoutRow} onPress={handleSignOut}>
          <View style={[styles.iconWrap, { backgroundColor: '#FDECEA' }]}>
            <Ionicons name="log-out-outline" size={22} color={C.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: C.red }]}>Se déconnecter</Text>
            <Text style={[styles.rowHint, { color: C.red }]}>{membership?.role === 'admin' ? membership?.factoryName : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.red} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 20,
  },
  profileLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: 12 },
  avatarPlaceholder: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarInitials: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  profileMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  rolePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  rolePillText: { fontSize: 11, fontWeight: '700' },
  factoryLabel: { fontSize: 12, color: C.muted, flex: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 16 },
  list: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#F0F0EE' },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#E8F6F0', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rowLabel: { fontSize: 16, color: C.text, fontWeight: '500' },
  rowHint: { fontSize: 12, color: C.muted, marginTop: 1 },
  dangerSection: { marginTop: 28 },
  dangerTitle: { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  logoutRow: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: '#FDECEA' },
});
