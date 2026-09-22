import React, { useRef } from 'react';
import { Animated, GestureResponderEvent, Pressable, StyleProp, ViewStyle } from 'react-native';

interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  // How far the surface shrinks on press — 0.97 (the default) reads as a
  // light tactile dip for buttons/rows; a bigger, more "grabbable" surface
  // (a full product card) can look better with a slightly smaller dip.
  scaleTo?: number;
}

// Robinhood/Spotify-style tactile press feedback: a quick scale-down on
// press-in that springs back on release, instead of the flatter opacity-only
// fade `TouchableOpacity` gives by default. Reads as "physical" — the thing
// you tapped visibly compresses under your finger. Built on RN's core
// `Animated` (no reanimated dependency), same posture as AppModal's own
// spring animation, so this adds zero new native surface.
// Memoized — this wraps every product-grid card, list row, and button in the
// app, so an unrelated state change elsewhere on the same screen (typing in
// a field, a cart quantity tick) would otherwise re-render every single
// instance and re-create its internal Animated.View element for nothing.
// React.memo skips that unless this instance's own props actually changed.
export const PressableScale = React.memo(function PressableScale({
  children, onPress, disabled, style, scaleTo = 0.97,
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
});
