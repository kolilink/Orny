import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';

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
import CreancesScreen from '../screens/Creances';

import { RootStackParamList, TabParamList } from '../types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_OPTIONS = {
  tabBarActiveTintColor: '#1D9E75',
  tabBarInactiveTintColor: '#6B6B66',
  tabBarStyle: { backgroundColor: '#FFFFFF' },
  headerShown: false,
} as const;

function FullTabNavigator() {
  return (
    <Tab.Navigator screenOptions={TAB_OPTIONS}>
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

function InvestorTabNavigator() {
  return (
    <Tab.Navigator screenOptions={TAB_OPTIONS}>
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tab.Screen name="Plus" component={PlusScreen}
        options={{ tabBarLabel: 'Plus', tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { membership } = useAuth();
  const TabNav = membership?.role === 'investor' ? InvestorTabNavigator : FullTabNavigator;

  return (
    <Stack.Navigator>
      <Stack.Screen name="Tabs" component={TabNav} options={{ headerShown: false }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents', headerTintColor: '#1D9E75' }} />
      <Stack.Screen name="AddDocument" component={AddDocumentScreen} options={{ title: 'Nouveau document', headerTintColor: '#1D9E75' }} />
      <Stack.Screen name="DocumentDetail" component={DocumentDetailScreen} options={{ title: 'Détail du document', headerTintColor: '#1D9E75' }} />
      <Stack.Screen name="Clients" component={ClientsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Investors" component={InvestorsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Rapports', headerTintColor: '#1D9E75' }} />
      <Stack.Screen name="Flavors" component={FlavorsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Bulks" component={BulksScreen} options={{ headerShown: false }} />
      <Stack.Screen name="FactorySettings" component={FactorySettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Coach" component={CoachScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Expenses" component={ExpensesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CustomerOrders" component={CustomerOrdersScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Creances" component={CreancesScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function AuthGate() {
  const { session, membership, loading } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

  if (loading) {
    return <View style={styles.splash}><ActivityIndicator size="large" color="#1D9E75" /></View>;
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

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#F8F8F6', alignItems: 'center', justifyContent: 'center' },
});
