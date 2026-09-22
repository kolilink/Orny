import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from './ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPendingCount, onQueueChange } from '../lib/syncQueue';
import { Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

// Amber strip shown whenever a write couldn't reach Supabase and is waiting
// for connectivity to come back — without this, a failed sync was totally
// invisible: the device that made it looked fine, and nobody (least of all
// a remote investor checking numbers from another device) had any sign that
// something hadn't actually gone through.
//
// Rendered as an absolute overlay (not pushed into normal layout flow) so it
// doesn't disturb every screen's own insets.top-based padding — this repo has
// no shared <Screen> wrapper, each screen manages its own safe-area padding.
export default function SyncBanner() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    getPendingCount().then(setPending);
    return onQueueChange(setPending);
  }, []);

  if (pending === 0) return null;

  return (
    <View style={[styles.banner, { top: insets.top }]} pointerEvents="none">
      <ActivityIndicator size="small" color={palette.caution} />
      <Text style={styles.text}>
        {pending} modification{pending > 1 ? 's' : ''} en attente de connexion
      </Text>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  banner: {
    position: 'absolute', left: 0, right: 0, zIndex: 999,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.cautionSoft, paddingVertical: 6, paddingHorizontal: 12,
  },
  text: { fontSize: 12, fontWeight: '600', color: palette.caution },
});
