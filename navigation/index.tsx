import React, { useState, useRef, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { drainSyncQueue } from '../lib/syncQueue';
import { registerPushToken } from '../lib/pushToken';
import SyncBanner from '../components/SyncBanner';

import LoginScreen from '../screens/Auth/LoginScreen';
import RegisterScreen from '../screens/Auth/RegisterScreen';
import FactorySetupScreen from '../screens/Auth/FactorySetupScreen';

import DashboardScreen from '../screens/Dashboard';
import VentesScreen from '../screens/Ventes';
import ProductionScreen from '../screens/Production';
import StockScreen from '../screens/Stock';
import PlusScreen from '../screens/Plus';
import DocumentsScreen from '../screens/Documents';
import AddDocumentScreen from '../screens/Documents/AddDocument';
import DocumentDetailScreen from '../screens/Documents/DocumentDetail';
import ClientsScreen from '../screens/Clients';
import InvestorsScreen from '../screens/Investors';
import ReportsScreen from '../screens/Reports';
import FlavorsScreen from '../screens/Flavors';
import BulksScreen from '../screens/Bulks';
import FactorySettingsScreen from '../screens/FactorySettings';
import CoachScreen from '../screens/Coach';
import ProfileScreen from '../screens/Profile';
import ExpensesScreen from '../screens/Expenses';
import SuppliersScreen from '../screens/Suppliers';
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
const makeTabOptions = (palette: Palette) => ({
  tabBarActiveTintColor: palette.moss,
  tabBarInactiveTintColor: palette.muted,
  tabBarStyle: { backgroundColor: palette.card },
  headerShown: false,
} as const);

function FullTabNavigator() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator screenOptions={makeTabOptions(palette)}>
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tab.Screen name="Ventes" component={VentesScreen}
        options={{ tabBarLabel: 'Ventes', tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} /> }} />
      <Tab.Screen name="Production" component={ProductionScreen}
        options={{ tabBarLabel: 'Production', tabBarIcon: ({ color, size }) => <Ionicons name="construct" size={size} color={color} /> }} />
      <Tab.Screen name="Stock" component={StockScreen}
        options={{ tabBarLabel: 'Stock', tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarLabel: 'Plus', tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

// Shared by 'investor' and 'inspecteur' — both get the same minimal
// Dashboard + Plus shape; what actually differs between them is which
// items Plus's own role-filtered menu shows (see screens/Plus/index.tsx),
// not the tab set itself.
function RestrictedTabNavigator() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator screenOptions={makeTabOptions(palette)}>
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarLabel: 'Plus', tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
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
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tab.Screen name="Ventes" component={VentesScreen}
        options={{ tabBarLabel: 'Ventes', tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarLabel: 'Plus', tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
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

  useEffect(() => {
    drainSyncQueue();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') drainSyncQueue();
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
      <Stack.Navigator>
      <Stack.Screen name="Tabs" component={TabNav} options={{ headerShown: false }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents', headerTintColor: palette.moss }} />
      <Stack.Screen name="AddDocument" component={AddDocumentScreen} options={{ title: 'Nouveau document', headerTintColor: palette.moss }} />
      <Stack.Screen name="DocumentDetail" component={DocumentDetailScreen} options={{ title: 'Détail du document', headerTintColor: palette.moss }} />
      <Stack.Screen name="Clients" component={ClientsScreen} options={{ title: 'Clients', headerTintColor: palette.moss }} />
      <Stack.Screen name="Investors" component={InvestorsScreen} options={{ title: 'Investisseurs', headerTintColor: palette.moss }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Bilan', headerTintColor: palette.moss }} />
      <Stack.Screen name="Flavors" component={FlavorsScreen} options={{ title: 'Produits', headerTintColor: palette.moss }} />
      <Stack.Screen name="Bulks" component={BulksScreen} options={{ title: 'Lots', headerTintColor: palette.moss }} />
      <Stack.Screen name="FactorySettings" component={FactorySettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Coach" component={CoachScreen} options={{ title: 'Orny AI', headerTintColor: palette.moss }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Expenses" component={ExpensesScreen} options={{ title: 'Dépenses', headerTintColor: palette.moss }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Fournisseurs & Achats', headerTintColor: palette.moss }} />
      <Stack.Screen name="CustomerOrders" component={CustomerOrdersScreen} options={{ title: 'Commandes clients', headerTintColor: palette.moss }} />
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
