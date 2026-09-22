import React from 'react';
import { StyleProp, TextInput, TextStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { formatAmountInput } from '../../utils/format';

interface MoneyInputProps {
  // Plain digits, e.g. "1010000" — exactly what every existing amount field
  // in this app already stores and passes to parseInt()/parseFloat() at
  // submit time. This component only changes what's DISPLAYED while
  // typing; the value/onChangeText contract is unchanged, so it's a
  // drop-in replacement for a raw <TextInput keyboardType="numeric">
  // wherever the value represents a GNF amount — no surrounding form logic
  // needs to change.
  value: string;
  onChangeText: (raw: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  autoFocus?: boolean;
}

// Space-groups a money amount as the user types it — direct request: raw
// digits ("1010000") are hard to read at a glance, and every amount in this
// app is GNF, a whole-unit currency with no decimal point to protect, so
// grouping is purely a display concern (see utils/format.ts's
// formatAmountInput/parseAmountInput, which this wraps). Every screen that
// captures a money amount should use this instead of a bare
// `<TextInput keyboardType="numeric">`.
export function MoneyInput({ value, onChangeText, placeholder = '0', style, autoFocus }: MoneyInputProps) {
  const { palette } = useTheme();
  return (
    <TextInput
      style={style}
      value={formatAmountInput(value)}
      onChangeText={(text) => onChangeText(text.replace(/\D/g, ''))}
      keyboardType="numeric"
      placeholder={placeholder}
      placeholderTextColor={palette.muted}
      autoFocus={autoFocus}
    />
  );
}
