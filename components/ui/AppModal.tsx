import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal as RNModal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography, WIDE_BREAKPOINT, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

interface AppModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  dismissOnBackdrop?: boolean;
  showCloseButton?: boolean;
}

// The one modal/sheet primitive for the app. Responsive by window width, not
// by platform — the same PWA build is a phone browser and a desktop browser,
// so the check has to be useWindowDimensions(), not Platform.OS:
//   - narrow (phone width, most native use): bottom sheet, slides up
//   - wide (tablet / desktop PWA): centered card dialog, fades + scales in
// Built on RN's built-in Animated (no reanimated dependency) to keep this
// app's footprint small for low-end Android devices on slow connections.
export function AppModal({
  visible,
  onClose,
  title,
  children,
  dismissOnBackdrop = true,
  showCloseButton = true,
}: AppModalProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(progress, {
        toValue: 1,
        friction: 9,
        tension: 60,
        useNativeDriver,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        useNativeDriver,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  // Web has no hardware back button and no bottom-sheet swipe gesture —
  // Escape is the equivalent dismiss affordance there.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  if (!mounted) return null;

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const dialogWidth = Math.min(width - spacing.xl * 2, 440);

  return (
    <RNModal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[
          styles.root,
          { justifyContent: isWide ? 'center' : 'flex-end', alignItems: isWide ? 'center' : 'stretch' },
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissOnBackdrop ? onClose : undefined} />
        </Animated.View>

        <Animated.View
          style={[
            isWide
              ? [styles.dialogWide, { width: dialogWidth, opacity: backdropOpacity, transform: [{ scale }] }]
              : [styles.sheetNarrow, { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] }],
          ]}
        >
          {(title || showCloseButton) && (
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{title ?? ''}</Text>
              {showCloseButton && (
                <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                  <Ionicons name="close" size={20} color={palette.muted} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <View>{children}</View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: palette.overlay },
  sheetNarrow: {
    backgroundColor: palette.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    maxHeight: '88%',
  },
  dialogWide: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { ...typography.dialogTitle, color: palette.ink, flex: 1 },
  closeBtn: { padding: spacing.xs, marginLeft: spacing.sm },
});
