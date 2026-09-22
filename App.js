import 'react-native-gesture-handler';
import React, { useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { ThemeProvider } from './theme/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import Navigation from './navigation';

// Keep the native splash on screen until Inter is actually loaded — without
// this, the very first frame renders in the OS system font and then visibly
// swaps to Inter the instant it finishes loading, a flash of the wrong
// typeface on every cold start. Must run at module scope, before React ever
// renders anything.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  // A genuine font-load failure (corrupt cache, exotic device) must not
  // block the app forever behind a splash screen that never goes away —
  // fontError still lets rendering proceed, just silently on the system
  // font instead (components/ui/AppText.tsx's mapping simply won't find a
  // registered "Inter_*" family and RN falls back automatically).
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider onLayout={onLayoutRootView}>
        <ToastProvider>
          <AuthProvider>
            <Navigation />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
