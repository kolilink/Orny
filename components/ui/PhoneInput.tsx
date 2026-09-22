import React, { useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './AppText';
import { AppModal } from './AppModal';
import { radius, spacing, Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { ALL_COUNTRIES, PINNED_CODES, detectCountryCode, type Country } from '../../lib/countries';

interface PhoneInputProps {
  // Full E.164 number ("+224620000000") or empty string. Only read to seed
  // the initial country/digits on mount — this component is otherwise
  // uncontrolled, matching every screen's own remount-on-modal-open shape
  // (AppModal unmounts its children entirely while closed, so a fresh
  // instance always picks up whatever `value` was current when it reopens).
  value: string;
  onChangeText: (e164: string) => void;
  label?: string;
  autoFocus?: boolean;
}

function parseE164(e164: string): { country: Country; local: string } | null {
  if (!e164?.startsWith('+')) return null;
  const sorted = [...ALL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (e164.startsWith(c.dial)) return { country: c, local: e164.slice(c.dial.length) };
  }
  return null;
}

const PINNED = PINNED_CODES.map((c) => ALL_COUNTRIES.find((x) => x.code === c)!).filter(Boolean);
const REST = ALL_COUNTRIES.filter((c) => !PINNED_CODES.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

type ListItem = Country | { divider: true };

function buildList(search: string): ListItem[] {
  if (search) {
    const q = search.toLowerCase();
    return ALL_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase().includes(q)
    ).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  return [...PINNED, { divider: true }, ...REST];
}

// Country-code phone entry (flag + dial code + digit slots), matching the
// sibling Patron app's own PhoneInput — same reference the "+224 by
// default" / "can't start with a zero" report pointed at. Defaults to
// Guinea (this factory's own country) unless `value` already carries a
// different one.
export function PhoneInput({ value, onChangeText, label, autoFocus }: PhoneInputProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const defaultCountry = ALL_COUNTRIES.find((c) => c.code === detectCountryCode()) ?? PINNED[0];
  const parsed = value ? parseE164(value) : null;
  // A legacy phone string with no leading "+" (every number saved before
  // this component existed) is treated as an already-Guinean local number
  // rather than discarded — it still displays and edits correctly.
  const [country, setCountry] = useState<Country>(parsed?.country ?? defaultCountry);
  const [localNumber, setLocalNumber] = useState(parsed?.local ?? (value && !value.startsWith('+') ? value.replace(/\D/g, '') : ''));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const inputRef = useRef<TextInput>(null);
  const blink = useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 530, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 530, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const emit = (c: Country, local: string) => onChangeText(local ? `${c.dial}${local}` : '');

  const handleChangeText = (t: string) => {
    const raw = t.replace(/\D/g, '');

    // A pasted/autofilled full international number can carry a different
    // country than the one currently selected — resolve it from the digits
    // themselves instead of assuming it matches what's on screen.
    if (raw.length > country.digits + 1) {
      const p = parseE164(`+${raw}`);
      if (p) {
        setCountry(p.country);
        const local = p.local.slice(0, p.country.digits);
        setLocalNumber(local);
        emit(p.country, local);
        return;
      }
    }

    // Strip a leading trunk-prefix 0 only when pasting a full number that's
    // too long for this country — never while typing digit by digit, since
    // many countries' mobile numbers (Guinea included) genuinely start
    // with 0 and a naive strip-on-every-keystroke would make it impossible
    // to ever type one.
    let digits = raw.startsWith('0') && raw.length > country.digits ? raw.slice(1) : raw;
    const prefix = country.dial.replace('+', '');
    if (digits.startsWith(prefix) && digits.length > country.digits) {
      digits = digits.slice(prefix.length);
    }
    const local = digits.slice(0, country.digits);
    setLocalNumber(local);
    emit(country, local);
  };

  const handleSelectCountry = (c: Country) => {
    setCountry(c);
    setLocalNumber('');
    setPickerOpen(false);
    setSearch('');
    emit(c, '');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const listData = useMemo(() => buildList(search), [search]);

  const renderSlots = () => {
    const slots: React.ReactElement[] = [];
    for (let i = 0; i < country.digits; i++) {
      const char = localNumber[i];
      const isNext = i === localNumber.length && localNumber.length < country.digits;
      if (i > 0 && i % 3 === 0) slots.push(<Text key={`sep-${i}`} style={styles.sep}> </Text>);
      if (char) {
        slots.push(<Text key={i} style={styles.filledDigit}>{char}</Text>);
      } else if (isNext) {
        slots.push(<Animated.Text key={i} style={[styles.emptyDigit, { opacity: blink }]}>_</Animated.Text>);
      } else {
        slots.push(<Text key={i} style={[styles.emptyDigit, { opacity: 0.25 }]}>_</Text>);
      }
    }
    return slots;
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if ('divider' in item) return <View style={styles.divider} />;
    return (
      <Pressable onPress={() => handleSelectCountry(item)} style={({ pressed }) => [styles.countryRow, pressed && { opacity: 0.6 }]}>
        <Text style={styles.countryFlag}>{item.flag}</Text>
        <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>{item.name}</Text>
        <Text style={{ fontSize: 13, color: palette.muted }}>{item.dial}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable style={styles.inputRow} onPress={() => inputRef.current?.focus()}>
        <Pressable onPress={() => setPickerOpen(true)} style={styles.countryBtn}>
          <Text style={styles.flagLarge}>{country.flag}</Text>
          <Text style={styles.dialCode}>{country.dial}</Text>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
        <View style={styles.vertDivider} />
        <View style={styles.digitRow}>
          {renderSlots()}
          <TextInput
            ref={inputRef}
            value={localNumber}
            onChangeText={handleChangeText}
            keyboardType="number-pad"
            maxLength={country.digits + 1}
            style={styles.hiddenInput}
            caretHidden
            selectionColor="transparent"
            autoFocus={autoFocus}
          />
        </View>
      </Pressable>

      <AppModal visible={pickerOpen} onClose={() => { setPickerOpen(false); setSearch(''); }} title="Choisir un pays">
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder="Pays ou indicatif"
            placeholderTextColor={palette.muted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <FlatList
          data={listData}
          keyExtractor={(item, i) => ('divider' in item ? `div-${i}` : item.code)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 360 }}
        />
      </AppModal>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    container: { gap: 6 },
    label: { fontSize: 13, fontWeight: '600', color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    inputRow: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: p.line, borderRadius: radius.sm,
      backgroundColor: p.paper, minHeight: 52, overflow: 'hidden',
    },
    countryBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: 4 },
    flagLarge: { fontSize: 20 },
    dialCode: { fontSize: 15, color: p.ink, fontWeight: '500' },
    chevron: { fontSize: 10, color: p.muted, marginTop: 2 },
    vertDivider: { width: 1, height: 26, backgroundColor: p.line },
    digitRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, overflow: 'hidden' },
    filledDigit: { fontSize: 17, fontWeight: '500', color: p.ink },
    emptyDigit: { fontSize: 17, fontWeight: '400', color: p.muted },
    sep: { fontSize: 17, color: p.muted, width: 7, textAlign: 'center' },
    hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent', backgroundColor: 'transparent' },
    searchWrap: { paddingBottom: spacing.sm },
    searchInput: {
      backgroundColor: p.paper, borderRadius: radius.sm, borderWidth: 1,
      borderColor: p.line, padding: 12, fontSize: 15, color: p.ink,
    },
    countryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    countryFlag: { fontSize: 22 },
    divider: { height: 1, backgroundColor: p.line, marginVertical: spacing.xs },
  });
