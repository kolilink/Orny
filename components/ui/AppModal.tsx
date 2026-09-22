import React, { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, KeyboardEvent as RNKeyboardEvent, LayoutAnimation, Modal as RNModal, PanResponder, Platform, Pressable, StyleSheet, TouchableOpacity, UIManager, View, useWindowDimensions } from 'react-native';
import { Text } from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography, WIDE_BREAKPOINT, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

// Pre-New-Architecture Android needs this opt-in for LayoutAnimation to
// actually animate anything; harmless / already-on on newer RN. Module
// scope so it only ever runs once.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
//
// RULE — keyboard handling lives here, once, and nowhere else. Never wrap an
// AppModal's children in your own KeyboardAvoidingView. Every call site used
// to do exactly that (`behavior: Platform.OS === 'ios' ? 'padding' : undefined`),
// which was broken on both platforms: on Android, `undefined` behavior means
// KeyboardAvoidingView does nothing at all, leaving the keyboard to a
// portalled RN <Modal>'s own native window, which doesn't reliably inherit
// the main window's automatic resize; on iOS, nested inside this
// component's own fixed-height sheet, "padding" had nowhere to push against,
// so the sheet's actual position never moved and a focused field could end
// up hidden behind the keyboard entirely (the exact bug this fixes). Fixed
// by measuring the real keyboard height directly via `Keyboard` events —
// sidestepping KeyboardAvoidingView's per-platform heuristics entirely — and
// using it to (1) shrink this sheet/dialog's own max height so it always
// fits above the keyboard and (2) lift the bottom sheet by that same amount.
// Content that needs to scroll should still use a plain
// `<ScrollView keyboardShouldPersistTaps="handled">` — just never a
// KeyboardAvoidingView around it.
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
  const { width, height } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const [mounted, setMounted] = useState(visible);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== 'web';

  // Drag-to-dismiss (bottom-sheet mode only — see isWide below) — pulling
  // the header/handle down tracks the finger 1:1, then either finishes the
  // close (if dragged far or fast enough) or springs back to fully open,
  // exactly as if nothing happened. `onClose` is read via a ref so the
  // PanResponder (created once) never closes over a stale callback.
  const panY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const DISMISS_DISTANCE = 120;
  const DISMISS_VELOCITY = 0.5;
  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture once real downward movement is detected —
      // never on touch-start — so a plain tap on the close button (which
      // lives inside the same draggable header/handle region) still
      // reaches it untouched.
      onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) panY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          // Finish the motion already in progress — a fast flick keeps
          // going fast, a slow drag past the threshold finishes at a
          // matching slow pace — rather than a jarring instant snap.
          Animated.timing(panY, {
            toValue: height,
            duration: Math.max(90, 220 - gesture.vy * 120),
            useNativeDriver,
          }).start(() => {
            panY.setValue(0);
            onCloseRef.current();
          });
        } else {
          Animated.spring(panY, { toValue: 0, friction: 9, tension: 60, useNativeDriver }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      panY.setValue(0);
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

  // Real, measured keyboard height — see the RULE note above for why this
  // exists instead of KeyboardAvoidingView. iOS's `will` events fire before
  // the keyboard starts animating (with its real duration), so our own
  // layout shift can match its timing; Android only fires `did` reliably.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onShow = (e: RNKeyboardEvent) => {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          Platform.OS === 'ios' ? e.duration || 250 : 220,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
      setKeyboardHeight(e.endCoordinates.height);
    };
    const onHide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    };
    const subs = Platform.OS === 'ios'
      ? [Keyboard.addListener('keyboardWillShow', onShow), Keyboard.addListener('keyboardWillHide', onHide)]
      : [Keyboard.addListener('keyboardDidShow', onShow), Keyboard.addListener('keyboardDidHide', onHide)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  if (!mounted) return null;

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const dialogWidth = Math.min(width - spacing.xl * 2, 440);

  // Available room above the keyboard, plus a little breathing space at the
  // very top of the screen — both shapes cap themselves to this instead of a
  // flat percentage once the keyboard is showing, so a tall form always
  // still fits (and scrolls, via the caller's own ScrollView) rather than
  // ever sitting partly hidden behind the keyboard.
  const maxCardHeight = Math.min(height * 0.88, height - keyboardHeight - insets.top - spacing.xl);

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
              ? [styles.dialogWide, { width: dialogWidth, maxHeight: maxCardHeight, opacity: backdropOpacity, transform: [{ scale }] }]
              : [
                  styles.sheetNarrow,
                  {
                    maxHeight: maxCardHeight,
                    paddingBottom: keyboardHeight > 0 ? spacing.lg : insets.bottom + spacing.lg,
                    marginBottom: keyboardHeight,
                    transform: [{ translateY: Animated.add(translateY, panY) }],
                  },
                ],
          ]}
        >
          {/* Drag-to-dismiss zone — the handle bar always renders (even
              when there's no title/close button, e.g. an actions-menu
              view with showCloseButton={false}), so there's always
              something to grab; the header row shares the same gesture
              when it's also present. Narrow/bottom-sheet mode only — a
              centered dialog on wide/desktop isn't something you'd drag. */}
          {!isWide && (
            <View {...panResponder.panHandlers}>
              <View style={styles.dragHandle} />
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
            </View>
          )}
          {isWide && (title || showCloseButton) && (
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{title ?? ''}</Text>
              {showCloseButton && (
                <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                  <Ionicons name="close" size={20} color={palette.muted} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={styles.body}>{children}</View>
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
  },
  dialogWide: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  // The standard bottom-sheet "grabber" affordance — gives the
  // drag-to-dismiss gesture something visible and discoverable to grab,
  // even on a view with no title/close button of its own.
  dragHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.line,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { ...typography.dialogTitle, color: palette.ink, flex: 1 },
  closeBtn: { padding: spacing.xs, marginLeft: spacing.sm },
  // flexShrink lets a scrollable child (every form's own ScrollView) resolve
  // a real bounded height from the sheet's maxHeight above and actually
  // scroll, instead of overflowing past the sheet's rounded edges.
  body: { flexShrink: 1 },
});
