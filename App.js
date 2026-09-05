import 'react-native-gesture-handler';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './theme/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import Navigation from './navigation';

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <ToastProvider>
          <AuthProvider>
            <Navigation />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
