import React from 'react';
import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Text } from './AppText';
import { radius, spacing, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { PressableScale } from './PressableScale';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

const HEIGHT = { sm: 36, md: 44, lg: 52 } as const;
const FONT_SIZE = { sm: 13, md: 14, lg: 16 } as const;

export function Button({
  label, onPress, variant = 'primary', size = 'md', disabled, loading, fullWidth, style,
}: ButtonProps) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const isDisabled = disabled || loading;

  const bg =
    variant === 'primary' ? palette.moss :
    variant === 'danger' ? palette.critical :
    variant === 'secondary' ? palette.mossSoft :
    'transparent';

  const textColor =
    variant === 'primary' || variant === 'danger' ? palette.white :
    variant === 'secondary' ? palette.mossDeep :
    palette.ink;

  const border = variant === 'ghost' ? { borderWidth: 1, borderColor: palette.line } : null;

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        { height: HEIGHT[size], backgroundColor: bg, opacity: isDisabled ? 0.5 : 1 },
        fullWidth && { alignSelf: 'stretch' },
        border,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={[styles.label, { color: textColor, fontSize: FONT_SIZE[size] }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '700' },
});
