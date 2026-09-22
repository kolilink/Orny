import React from 'react';
import { Text as RNText, TextProps, TextStyle, StyleSheet } from 'react-native';

// Maps this app's existing `fontWeight` values (every screen already uses
// these, unchanged) to the specific pre-weighted Inter font file to render
// with. Google Fonts ships one font FILE per weight rather than a single
// variable font RN can fake-bold from `fontWeight` alone — so the mapping,
// not the screen's own style, is what actually selects the right file.
const WEIGHT_TO_FONT: Record<string, string> = {
  '100': 'Inter_400Regular', '200': 'Inter_400Regular', '300': 'Inter_400Regular',
  '400': 'Inter_400Regular', normal: 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold', bold: 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_800ExtraBold',
};

function flatten(style: TextProps['style']): TextStyle {
  return (StyleSheet.flatten(style) as TextStyle) || {};
}

// Drop-in replacement for React Native's own `Text`, imported from
// `components/ui` instead of `react-native` — every screen keeps writing
// ordinary `fontWeight: '700'` in its own StyleSheet exactly as before,
// and this component is the one place that resolves that into the actual
// loaded Inter font file, so the whole app gets a real branded typeface
// without every screen needing its own `fontFamily` line. A style that
// already sets `fontFamily` explicitly is left alone (e.g. a genuine need
// for the plain system font) — this never overrides that.
export function Text(props: TextProps) {
  const flat = flatten(props.style);
  if (flat.fontFamily) return <RNText {...props} />;
  const fontFamily = WEIGHT_TO_FONT[String(flat.fontWeight ?? '400')] ?? 'Inter_400Regular';
  return <RNText {...props} style={[props.style, { fontFamily }]} />;
}
