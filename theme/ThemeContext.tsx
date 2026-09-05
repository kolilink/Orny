import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paletteLight, paletteDark, Palette } from './tokens';

export type ColorSchemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'orny_color_scheme';

type ThemeContextValue = {
  palette: Palette;
  colorScheme: ColorSchemePreference;
  resolvedScheme: 'light' | 'dark';
  setColorScheme: (pref: ColorSchemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  // Starts on 'system' (the sane default) and updates once the persisted
  // preference loads — no blocking read before the first render, so
  // there's nothing to gate the rest of the app's startup on.
  const [colorScheme, setColorSchemeState] = useState<ColorSchemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setColorSchemeState(v);
    });
  }, []);

  const setColorScheme = (pref: ColorSchemePreference) => {
    setColorSchemeState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
  };

  const resolvedScheme: 'light' | 'dark' =
    colorScheme === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : colorScheme;

  const palette = resolvedScheme === 'dark' ? paletteDark : paletteLight;

  const value = useMemo(
    () => ({ palette, colorScheme, resolvedScheme, setColorScheme }),
    [palette, colorScheme, resolvedScheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
