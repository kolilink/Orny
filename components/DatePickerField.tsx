import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Native date picker — not imported on web to avoid crash
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

const C = {
  primary: '#1D9E75', border: '#E8E8E4', muted: '#6B6B66',
  bg: '#F8F8F6', text: '#1A1A18',
};

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
  const [show, setShow] = useState(false);
  const date = value ? new Date(value + 'T12:00:00') : new Date();

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.webRow}>
          <Ionicons name="calendar-outline" size={18} color={C.primary} style={{ marginRight: 8 }} />
          {/* @ts-ignore — web-only input */}
          <input
            type="date"
            value={value}
            onChange={(e: any) => onChange(e.target.value)}
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 15, color: C.text, outline: 'none', cursor: 'pointer',
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.btn} onPress={() => setShow(true)}>
        <Ionicons name="calendar-outline" size={18} color={C.primary} />
        <Text style={styles.btnText}>{formatDisplay(value)}</Text>
      </TouchableOpacity>
      {show && DateTimePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display="spinner"
          onChange={(_: any, selected?: Date) => {
            setShow(false);
            if (selected) onChange(toYMD(selected));
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 14, backgroundColor: C.bg,
  },
  btnText: { fontSize: 15, color: C.text, fontWeight: '500' },
  webRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 14, backgroundColor: C.bg,
  },
});
