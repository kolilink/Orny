import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList } from '../../types';
import { FACTORY_CONFIG } from '../../config/factory';

type PlusNav = NativeStackNavigationProp<RootStackParamList>;

const C = {
  primary: '#1D9E75',
  red: '#E24B4A',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
};

const MENU_SECTIONS: {
  title: string;
  items: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    route: keyof RootStackParamList;
    hint?: string;
  }[];
}[] = [
  {
    title: 'Gestion',
    items: [
      { label: 'Clients', icon: 'people', route: 'Clients', hint: 'Annuaire & créances' },
      { label: 'Investisseurs', icon: 'trending-up', route: 'Investors', hint: 'Capital & versements' },
      { label: 'Documents', icon: 'document-text', route: 'Documents', hint: 'Contrats & licences' },
    ],
  },
  {
    title: 'Produits',
    items: [
      { label: 'Saveurs', icon: 'color-palette', route: 'Flavors', hint: 'Créer & gérer les saveurs' },
      { label: 'Vrac / Lots', icon: 'layers', route: 'Bulks', hint: 'Créer & gérer les lots' },
    ],
  },
  {
    title: 'Analyses',
    items: [
      { label: 'Rapports', icon: 'bar-chart', route: 'Reports', hint: 'Statistiques & tendances' },
    ],
  },
];

export default function PlusScreen() {
  const navigation = useNavigation<PlusNav>();
  const insets = useSafeAreaInsets();

  const handleReset = () => {
    Alert.alert(
      'Réinitialiser toutes les données',
      'Toutes les ventes, clients, stocks, investisseurs et documents seront supprimés. Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réinitialiser',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.clear();
            await AsyncStorage.setItem('demo_loaded_v2', 'true');
            Alert.alert(
              'Données supprimées',
              'Toutes les données ont été effacées. Fermez et rouvrez l\'application pour commencer.'
            );
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.factory}>{FACTORY_CONFIG.name}</Text>
      <Text style={styles.title}>Plus</Text>

      {MENU_SECTIONS.map((section) => (
        <View key={section.title}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.list}>
            {section.items.map((item, idx) => (
              <TouchableOpacity
                key={item.label}
                style={[
                  styles.row,
                  idx === section.items.length - 1 && { borderBottomWidth: 0 },
                ]}
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

      <View style={styles.dangerSection}>
        <Text style={styles.dangerTitle}>Zone danger</Text>
        <TouchableOpacity style={styles.resetRow} onPress={handleReset}>
          <View style={[styles.iconWrap, { backgroundColor: '#FDECEA' }]}>
            <Ionicons name="trash-outline" size={22} color={C.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: C.red }]}>Réinitialiser toutes les données</Text>
            <Text style={[styles.rowHint, { color: C.red }]}>Action irréversible</Text>
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
  factory: { fontSize: 13, color: C.muted, marginBottom: 2 },
  title: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 20 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: C.muted,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 8, marginTop: 16,
  },
  list: {
    backgroundColor: C.card, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderColor: '#F0F0EE',
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#E8F6F0', alignItems: 'center', justifyContent: 'center',
    marginRight: 14,
  },
  rowLabel: { fontSize: 16, color: C.text, fontWeight: '500' },
  rowHint: { fontSize: 12, color: C.muted, marginTop: 1 },
  dangerSection: { marginTop: 28 },
  dangerTitle: { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  resetRow: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: '#FDECEA',
  },
});
