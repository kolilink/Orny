import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useState } from 'react';
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
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import Navigation from './navigation';

// Keep the native splash on screen until Inter is actually loaded — without
// this, the very first frame renders in the OS system font and then visibly
// swaps to Inter the instant it finishes loading, a flash of the wrong
// typeface on every cold start. Must run at module scope, before React ever
// renders anything.
SplashScreen.preventAutoHideAsync().catch(() => {});

// A hard ceiling on how long the native splash can stay up waiting for auth
// — AuthContext's own cold-start path already bounds itself (a 5s race on
// the no-cache path), but supabase.auth.getSession() itself has no such
// bound (it can block on a real network round trip to refresh an expired
// token). A splash that never hides reads as a hung/crashed app, which is
// strictly worse than the plain spinner it's replacing — this timeout is
// the safety net that keeps this change a pure improvement, never a new
// failure mode.
const AUTH_READY_TIMEOUT_MS = 8000;

// Bridges AuthContext's `loading` (true exactly once, during cold-start
// auth/membership resolution — see AuthContext.tsx's setLoading call sites)
// out to App, which sits above AuthProvider and has no context access of
// its own. Renders nothing; exists purely for this one effect.
function AuthReadySignal({ onReady }) {
  const { loading } = useAuth();
  useEffect(() => {
    if (!loading) onReady();
  }, [loading, onReady]);
  return null;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const [laidOut, setLaidOut] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const onLayoutRootView = useCallback(() => {
    setLaidOut(true);
  }, []);

  const markAuthReady = useCallback(() => setAuthReady(true), []);

  // Same reasoning as the old fonts-only version, extended to also cover
  // AuthContext's cold-start resolution — this is what actually removes the
  // visible loading spinner on open: previously the native splash only
  // waited on fonts (near-instant, no network), then hid, revealing
  // AuthGate's own <ActivityIndicator> underneath for however long session
  // restoration + the cached-membership read took. Now the same native,
  // branded splash simply stays up across that whole window instead, so a
  // normal cold start goes straight from splash to real content with no
  // separate loading screen in between at all.
  useEffect(() => {
    if ((fontsLoaded || fontError) && laidOut && authReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError, laidOut, authReady]);

  useEffect(() => {
    const t = setTimeout(markAuthReady, AUTH_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [markAuthReady]);

  // A genuine font-load failure (corrupt cache, exotic device) must not
  // block the app forever behind a splash screen that never goes away —
  // fontError still lets rendering proceed, just silently on the system
  // font instead (components/ui/AppText.tsx's mapping simply won't find a
  // registered "Inter_*" family and RN falls back automatically).
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider onLayout={onLayoutRootView}>
        <ToastProvider>
          <AuthProvider>
            <AuthReadySignal onReady={markAuthReady} />
            <Navigation />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
