import React, { useState } from 'react';
import { View, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Text } from './ui';
import { AppModal, Button } from './ui';
import { Ionicons } from '@expo/vector-icons';
import { radius, Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

// Native date picker — not imported on web to avoid crash
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

interface Props {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplay(ymd: string): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export default function DatePickerField({ label, value, onChange }: Props) {
  const { palette, resolvedScheme } = useTheme();
  const styles = makeStyles(palette);
  const [show, setShow] = useState(false);
  const date = value ? new Date(value + 'T12:00:00') : new Date();

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.webRow}>
          <Ionicons name="calendar-outline" size={18} color={palette.moss} style={{ marginRight: 8 }} />
          {/* @ts-ignore — web-only input */}
          <input
            type="date"
            value={value}
            onChange={(e: any) => onChange(e.target.value)}
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 15, color: palette.ink, outline: 'none', cursor: 'pointer',
            }}
          />
        </View>
      </View>
    );
  }

  // Android's declarative <DateTimePicker> maps internally to the same
  // modal dialog the imperative DateTimePickerAndroid.open() API shows —
  // "default" lets the OS pick its own native calendar/spinner presentation
  // per Android version, the most familiar choice, and onChange fires
  // exactly once (event.type 'set' on confirm, 'dismissed' on cancel), so
  // closing the picker the instant onChange fires is correct here.
  if (Platform.OS === 'android') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => setShow(true)}>
          <Ionicons name="calendar-outline" size={18} color={palette.moss} />
          <Text style={styles.btnText}>{formatDisplay(value)}</Text>
        </TouchableOpacity>
        {show && DateTimePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            onChange={(event: any, selected?: Date) => {
              setShow(false);
              if (event?.type === 'set' && selected) onChange(toYMD(selected));
            }}
          />
        )}
      </View>
    );
  }

  // iOS's "spinner" style has no dialog chrome of its own — it's an inline
  // wheel widget that fires onChange continuously as each column (day/
  // month/year) is scrolled, with no built-in "done" step. The previous
  // version called setShow(false) straight inside onChange, so the picker
  // vanished the instant the user moved a single wheel one tick — often
  // before they'd touched the other two columns at all, which is exactly
  // what read as "weird." Fixed by never closing from onChange: the value
  // updates live as they scroll (matching every reference implementation of
  // this display mode), and an explicit "Terminé" button — inside a real
  // sheet, since the bare picker has no dismiss affordance of its own — is
  // the only thing that closes it.
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.btn} onPress={() => setShow(true)}>
        <Ionicons name="calendar-outline" size={18} color={palette.moss} />
        <Text style={styles.btnText}>{formatDisplay(value)}</Text>
      </TouchableOpacity>
      <AppModal visible={show} onClose={() => setShow(false)} title={label}>
        {DateTimePicker && (
          // Explicit height/width — without it, iOS's "spinner" UIDatePicker
          // has no intrinsic size of its own to report, and collapses inside
          // AppModal's `body: { flexShrink: 1 }` wrapper to a plain empty
          // gray capsule with none of the actual day/month/year wheel
          // columns visible (reported live: "I don't even see the stuff").
          // 216 matches Apple's own standard wheel-picker height so the
          // three columns render at their normal, fully-legible size rather
          // than being squeezed into whatever space happened to be left.
          <DateTimePicker
            value={date}
            mode="date"
            display="spinner"
            style={styles.picker}
            // The height/width fix above wasn't the real bug: reported
            // still blank after that shipped. Without themeVariant, iOS's
            // native picker follows the OS-level system appearance, not
            // this app's own resolvedScheme — light/dark are two
            // independent settings (this app supports its own light/dark/
            // system preference, separate from the device's own). A
            // device in system Dark Mode with this app's theme set to (or
            // resolving to) light renders the picker's wheel digits in
            // light-mode text — pale/white — on top of AppModal's actual
            // light-theme white card background: invisible text on a
            // near-identical background, not a missing/collapsed picker.
            // What was actually visible (a plain gray capsule with nothing
            // legible in it) is iOS's own selected-row highlight bar —
            // real chrome, rendering correctly the whole time; only the
            // number text sitting on top of it was ever actually missing.
            themeVariant={resolvedScheme}
            onChange={(_: any, selected?: Date) => {
              if (selected) onChange(toYMD(selected));
            }}
          />
        )}
        <Button label="Terminé" onPress={() => setShow(false)} fullWidth style={{ marginTop: 8 }} />
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm,
    padding: 14, backgroundColor: palette.paper,
  },
  btnText: { fontSize: 15, color: palette.ink, fontWeight: '500' },
  webRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm,
    padding: 14, backgroundColor: palette.paper,
  },
  picker: { height: 216, width: '100%' },
});
