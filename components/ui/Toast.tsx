import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type ToastType = 'success' | 'warning' | 'info';
interface ToastMessage { id: number; text: string; type: ToastType }

type Listener = (msg: ToastMessage) => void;
let listener: Listener | null = null;
let counter = 0;

function emit(text: string, type: ToastType) {
  if (!listener) return; // no-op if <ToastProvider> isn't mounted yet
  listener({ id: ++counter, text, type });
}

// Call from anywhere (store, screen, util) without needing a hook — mirrors
// the ergonomics of Patron's `toast.success()` helper, separate implementation.
export const toast = {
  success: (text: string) => emit(text, 'success'),
  warning: (text: string) => emit(text, 'warning'),
  info: (text: string) => emit(text, 'info'),
};

const makeTone = (palette: Palette): Record<ToastType, { bg: string; icon: keyof typeof Ionicons.glyphMap }> => ({
  success: { bg: palette.moss, icon: 'checkmark-circle' },
  warning: { bg: palette.caution, icon: 'warning' },
  info: { bg: palette.ink, icon: 'information-circle' },
});

const DURATION_MS = 3000;

// Mount once at the app root (App.js), wrapping everything else, so
// toast.success()/warning()/info() work from any screen or store.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const TONE = makeTone(palette);
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    listener = (msg) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCurrent(msg);
      translateY.setValue(-120);
      Animated.spring(translateY, { toValue: 0, friction: 9, tension: 60, useNativeDriver }).start();
      timerRef.current = setTimeout(() => {
        Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver }).start(() => setCurrent(null));
      }, DURATION_MS);
    };
    return () => { listener = null; };
  }, []);

  const tone = current ? TONE[current.type] : null;

  return (
    <>
      {children}
      {current && tone && (
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { top: insets.top + spacing.sm, transform: [{ translateY }] }]}
        >
          <View style={[styles.bubble, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={18} color={palette.white} />
            <Text style={styles.text} numberOfLines={2}>{current.text}</Text>
          </View>
        </Animated.View>
      )}
    </>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
    paddingHorizontal: spacing.lg,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 480,
    width: '100%',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: { flex: 1, color: palette.white, fontSize: 14, fontWeight: '600' },
});
