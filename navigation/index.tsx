import React, { useState, useRef, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { drainSyncQueue } from '../lib/syncQueue';
import { registerPushToken } from '../lib/pushToken';
import { runAlertChecks } from '../utils/notifications';
import SyncBanner from '../components/SyncBanner';

import LoginScreen from '../screens/Auth/LoginScreen';
import RegisterScreen from '../screens/Auth/RegisterScreen';
import FactorySetupScreen from '../screens/Auth/FactorySetupScreen';

import VentesScreen from '../screens/Ventes';
import SalesHistoryScreen from '../screens/Ventes/History';
import ProductionScreen from '../screens/Production';
import StockScreen from '../screens/Stock';
import PlusScreen from '../screens/Plus';
import DocumentsScreen from '../screens/Documents';
import AddDocumentScreen from '../screens/Documents/AddDocument';
import DocumentDetailScreen from '../screens/Documents/DocumentDetail';
import ClientsScreen from '../screens/Clients';
import InvestorsScreen from '../screens/Investors';
import InvestorDetailScreen from '../screens/Investors/InvestorDetail';
import ReportsScreen from '../screens/Reports';
import FlavorsScreen from '../screens/Flavors';
import BulksScreen from '../screens/Bulks';
import FactorySettingsScreen from '../screens/FactorySettings';
import CoachScreen from '../screens/Coach';
import ProfileScreen from '../screens/Profile';
import ExpensesScreen from '../screens/Expenses';
import SuppliersScreen from '../screens/Suppliers';
import SupplierDetailScreen from '../screens/Suppliers/SupplierDetail';
import CustomerOrdersScreen from '../screens/CustomerOrders';
import NotificationsScreen from '../screens/Notifications';
import MachinesScreen from '../screens/Machines';

import { RootStackParamList, TabParamList } from '../types';
import { Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// Each *TabNavigator below is itself a real component, so it can call
// useTheme() directly rather than needing palette threaded in as a prop.
//
// Icon-only, no text labels (tabBarShowLabel: false) — a deliberate,
// app-wide choice, not a per-screen one, so it can never drift between tabs.
const makeTabOptions = (palette: Palette) => ({
  tabBarActiveTintColor: palette.moss,
  tabBarInactiveTintColor: palette.muted,
  tabBarStyle: { backgroundColor: palette.card },
  tabBarShowLabel: false,
  headerShown: false,
} as const);

// No "Accueil"/Dashboard tab, for any role — see CLAUDE.md "Navigation
// psychology" below for the full reasoning. Ventes is the first tab a
// seller-facing role lands on; the numbers that used to live on Dashboard
// now live on Reports (Bilan, via Plus) and on the Production screen itself.
function FullTabNavigator() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator screenOptions={makeTabOptions(palette)}>
      <Tab.Screen name="Ventes" component={VentesScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} /> }} />
      <Tab.Screen name="Production" component={ProductionScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="construct" size={size} color={color} /> }} />
      <Tab.Screen name="Stock" component={StockScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

// Shared by 'investor' and 'inspecteur' — neither can sell, and both exist
// specifically to look at the numbers, so (unlike every other role) their
// first tab IS the numbers screen: Reports (Bilan), not a stripped-down
// Dashboard. Same psychology as removing Dashboard elsewhere, applied in the
// other direction — the people whose job is data get it up front.
function RestrictedTabNavigator() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator screenOptions={makeTabOptions(palette)}>
      <Tab.Screen name="Reports" component={ReportsScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

// Vendeur (seller-only): can sell and manage clients, but has no access to
// Production or Stock — a market-stall seller shouldn't be logging batches
// or overriding raw-material/finished-goods counts.
function VendeurTabNavigator() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator screenOptions={makeTabOptions(palette)}>
      <Tab.Screen name="Ventes" component={VentesScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { membership, user } = useAuth();
  const { palette } = useTheme();
  const TabNav = membership?.role === 'investor' || membership?.role === 'inspecteur'
    ? RestrictedTabNavigator
    : membership?.role === 'vendeur'
    ? VendeurTabNavigator
    : FullTabNavigator;

  // runAlertChecks() (stock/predictive-stock/overdue-order pushes) used to
  // only ever run from the now-retired Dashboard tab's own load() — moved
  // here so it keeps firing regardless of which screen is open, or whether
  // a "home" screen exists at all.
  useEffect(() => {
    drainSyncQueue();
    runAlertChecks();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        drainSyncQueue();
        runAlertChecks();
      }
    });
    return () => sub.remove();
  }, []);

  // Once per app open, not per foreground — the Expo push token is stable
  // for the life of this install, so there's nothing to refresh on resume.
  useEffect(() => {
    if (user?.id && membership?.factoryId) {
      registerPushToken(user.id, membership.factoryId);
    }
  }, [user?.id, membership?.factoryId]);

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      {/* RULE: a screen either (a) has a native header here — no
          headerShown:false below — in which case the screen component
          itself must NOT add its own paddingTop: insets.top or its own
          duplicate title row (this navigator's header already owns both
          the title and the safe-area top inset), or (b) is registered with
          headerShown:false, in which case the screen builds and owns its
          entire header itself. Mixing the two — a native header here PLUS
          a screen that also reserves insets.top for its own header row —
          double-counts the top inset as a real blank gap between the
          native header and the screen's own content, which is exactly the
          bug this comment exists to prevent from coming back. */}
      {/* headerStyle here is the one themed default for every native header
          in the app — screens below only ever override `title`. Previously
          each screen only set headerTintColor (icon/text color), leaving
          the header's *background* on React Navigation's default white —
          a stark white bar on top of every dark-themed screen. */}
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: palette.card },
          headerTintColor: palette.moss,
          headerTitleStyle: { color: palette.ink },
          // A plain, constant back label — the default (previous screen's
          // own title) changes per navigation path and reads as noise.
          headerBackTitle: 'Retour',
        }}
      >
      <Stack.Screen name="Tabs" component={TabNav} options={{ headerShown: false }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents' }} />
      <Stack.Screen name="AddDocument" component={AddDocumentScreen} options={{ title: 'Nouveau document' }} />
      <Stack.Screen name="DocumentDetail" component={DocumentDetailScreen} options={{ title: 'Détail du document' }} />
      <Stack.Screen name="Clients" component={ClientsScreen} options={{ title: 'Clients' }} />
      <Stack.Screen name="SalesHistory" component={SalesHistoryScreen} options={{ title: 'Ventes' }} />
      <Stack.Screen name="Investors" component={InvestorsScreen} options={{ title: 'Investisseurs' }} />
      <Stack.Screen name="InvestorDetail" component={InvestorDetailScreen} options={{ title: 'Investisseur' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Bilan' }} />
      <Stack.Screen name="Flavors" component={FlavorsScreen} options={{ title: 'Produits' }} />
      <Stack.Screen name="Bulks" component={BulksScreen} options={{ title: 'Lots' }} />
      <Stack.Screen name="FactorySettings" component={FactorySettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Coach" component={CoachScreen} options={{ title: 'Claude' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Expenses" component={ExpensesScreen} options={{ title: 'Dépenses' }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Fournisseurs' }} />
      <Stack.Screen name="SupplierDetail" component={SupplierDetailScreen} options={{ title: 'Fournisseur' }} />
      <Stack.Screen name="CustomerOrders" component={CustomerOrdersScreen} options={{ title: 'Commandes clients' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Machines" component={MachinesScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </View>
  );
}

function AuthGate() {
  const { session, membership, loading, membershipLoading } = useAuth();
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const [showRegister, setShowRegister] = useState(false);

  // Once a membership is confirmed, never flash FactorySetupScreen during transitions.
  // React can batch setMembershipLoading(true/false) and skip the intermediate true state,
  // leaving a window where session≠null && membership=null. This ref plugs that gap.
  const hadMembership = useRef(false);
  if (membership) hadMembership.current = true;
  if (!session && !loading && !membershipLoading) hadMembership.current = false;

  const isTransitioning = session && hadMembership.current && !membership;

  if (loading || membershipLoading || isTransitioning) {
    return <View style={styles.splash}><ActivityIndicator size="large" color={palette.moss} /></View>;
  }

  if (!session) {
    if (showRegister) return <RegisterScreen onNavigateLogin={() => setShowRegister(false)} />;
    return <LoginScreen onNavigateRegister={() => setShowRegister(true)} />;
  }

  // Logged in but no factory (includes pending request — FactorySetupScreen shows waiting UI)
  if (!membership) return <FactorySetupScreen />;

  return <AppNavigator />;
}

export default function Navigation() {
  return (
    <NavigationContainer>
      <AuthGate />
    </NavigationContainer>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  splash: { flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' },
});
