import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { cardElevation, radius, spacing, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { PressableScale } from './PressableScale';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

// Surface container. One elevation signal only (a soft shadow) — no border
// stacked on top of it, so a card doesn't announce itself twice. A tappable
// card scales down slightly on press (PressableScale) rather than just
// dimming — the same tactile-feedback trick applied to Button.
export function Card({ children, onPress, style }: CardProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  if (onPress) {
    return (
      <PressableScale style={[styles.card, style]} onPress={onPress} scaleTo={0.98}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...cardElevation,
  },
});
