import React from 'react';
import { StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import { cardElevation, radius, spacing, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

// Surface container. One elevation signal only (a soft shadow) — no border
// stacked on top of it, so a card doesn't announce itself twice.
export function Card({ children, onPress, style }: CardProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
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
