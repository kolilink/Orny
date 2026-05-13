import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

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

import { RootStackParamList, TabParamList } from '../types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#1D9E75',
        tabBarInactiveTintColor: '#6B6B66',
        tabBarStyle: { backgroundColor: '#FFFFFF' },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Accueil',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Ventes"
        component={VentesScreen}
        options={{
          tabBarLabel: 'Ventes',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Production"
        component={ProductionScreen}
        options={{
          tabBarLabel: 'Production',
          tabBarIcon: ({ color, size }) => <Ionicons name="construct" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Stock"
        component={StockScreen}
        options={{
          tabBarLabel: 'Stock',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Plus"
        component={PlusScreen}
        options={{
          tabBarLabel: 'Plus',
          tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
        <Stack.Screen
          name="Documents"
          component={DocumentsScreen}
          options={{ title: 'Documents', headerTintColor: '#1D9E75' }}
        />
        <Stack.Screen
          name="AddDocument"
          component={AddDocumentScreen}
          options={{ title: 'Nouveau document', headerTintColor: '#1D9E75' }}
        />
        <Stack.Screen
          name="DocumentDetail"
          component={DocumentDetailScreen}
          options={{ title: 'Détail du document', headerTintColor: '#1D9E75' }}
        />
        <Stack.Screen
          name="Clients"
          component={ClientsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Investors"
          component={InvestorsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Reports"
          component={ReportsScreen}
          options={{ title: 'Rapports', headerTintColor: '#1D9E75' }}
        />
        <Stack.Screen
          name="Flavors"
          component={FlavorsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Bulks"
          component={BulksScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
