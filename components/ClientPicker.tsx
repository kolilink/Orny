import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Alert } from 'react-native';
import { Client } from '../types';
import { upsertClient } from '../store/clients';
import { Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { AppModal, Button, PhoneInput, Text } from './ui';

interface ClientPickerProps {
  clients: Client[];
  value: string;
  onChangeText: (name: string) => void;
  // Fires once a client is created from the inline quick-create sheet, so
  // the caller can merge it into its own client list without waiting for
  // the next full sync — e.g. so it shows up in `clients` immediately if
  // the same query is typed again this session.
  onClientCreated?: (client: Client) => void;
  label?: string;
}

// A number is "phone-shaped" once it has enough digits to plausibly be one
// and nothing that looks like a name (letters) — used only to decide
// whether to offer the quick-create-with-phone shortcut, never to validate
// or block anything.
function looksLikePhone(q: string): boolean {
  const digits = q.replace(/[\s+\-()]/g, '');
  return digits.length >= 6 && /^\d+$/.test(digits);
}

// The client field used by both Ventes and Commandes clients: type a name
// or a phone number, pick from matching existing clients, or — the gap this
// closes — when a typed phone number matches nobody, add a real client
// (name + phone, via the same country-aware PhoneInput used everywhere
// else) in one inline step instead of either blocking checkout or silently
// saving the phone digits themselves as the client's "name" (upsertClient's
// existing fallback, still there for anyone who skips this and just types a
// name directly — see its own call site for why that's still fine on its
// own).
export function ClientPicker({ clients, value, onChangeText, onClientCreated, label = 'Client' }: ClientPickerProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [focused, setFocused] = useState(false);
  const blurSuppressedRef = useRef(false);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const query = value.trim();
  const suggestions = query.length > 0
    ? clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || (c.phone && c.phone.includes(query)))
    : [];

  const offerQuickCreate = focused && query.length > 0 && suggestions.length === 0 && looksLikePhone(query);

  const openQuickCreate = () => {
    setQuickName('');
    setQuickPhone(query.startsWith('+') ? query : query.replace(/\D/g, ''));
    setQuickCreateOpen(true);
  };

  const handleQuickCreate = async () => {
    if (!quickName.trim()) return;
    setSaving(true);
    try {
      const client = await upsertClient(quickName.trim(), undefined, undefined, quickPhone || undefined);
      onChangeText(client.name);
      onClientCreated?.(client);
      setQuickCreateOpen(false);
      setFocused(false);
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible de créer le client. ${e?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.autocompleteWrap}>
        <TextInput
          style={styles.input}
          placeholder="Nom ou numéro de téléphone"
          placeholderTextColor={palette.muted}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => {
            if (!blurSuppressedRef.current) setFocused(false);
            blurSuppressedRef.current = false;
          }, 150)}
        />
        {focused && suggestions.length > 0 && (
          <View style={styles.suggestions}>
            {suggestions.map((client) => (
              <TouchableOpacity
                key={client.id}
                style={styles.suggestionItem}
                onPressIn={() => { blurSuppressedRef.current = true; }}
                onPress={() => { onChangeText(client.name); setFocused(false); }}
              >
                <Text style={styles.suggestionText}>{client.name}</Text>
                {client.phone ? <Text style={styles.suggestionPhone}>{client.phone}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        )}
        {offerQuickCreate && (
          <View style={styles.suggestions}>
            <TouchableOpacity
              style={styles.createRow}
              onPressIn={() => { blurSuppressedRef.current = true; }}
              onPress={openQuickCreate}
            >
              <Text style={styles.createRowText}>+ Créer un nouveau client pour "{query}"</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <AppModal visible={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} title="Nouveau client">
        <Text style={styles.fieldLabel}>Nom *</Text>
        <TextInput
          style={styles.plainInput}
          placeholder="Nom du client"
          placeholderTextColor={palette.muted}
          value={quickName}
          onChangeText={setQuickName}
          autoFocus
        />
        <PhoneInput label="Téléphone" value={quickPhone} onChangeText={setQuickPhone} />
        <Text style={styles.laterHint}>Vous pourrez compléter les autres informations plus tard dans Clients.</Text>
        <View style={styles.modalActions}>
          <Button label="Plus tard" variant="ghost" onPress={() => { onChangeText(query); setQuickCreateOpen(false); }} style={{ flex: 1 }} />
          <Button label="Créer" onPress={handleQuickCreate} loading={saving} disabled={!quickName.trim()} style={{ flex: 1 }} />
        </View>
      </AppModal>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', color: palette.ink },
  autocompleteWrap: { position: 'relative', zIndex: 10 },
  input: {
    backgroundColor: palette.card, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink,
  },
  suggestions: {
    position: 'absolute', top: 52, left: 0, right: 0,
    backgroundColor: palette.card, borderRadius: 12,
    borderWidth: 1, borderColor: palette.line,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
    zIndex: 20,
  },
  suggestionItem: { padding: 14, borderBottomWidth: 1, borderColor: palette.line },
  suggestionText: { fontSize: 15, color: palette.ink },
  suggestionPhone: { fontSize: 12, color: palette.muted, marginTop: 2 },
  createRow: { padding: 14 },
  createRowText: { fontSize: 14, color: palette.moss, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, marginTop: 4 },
  plainInput: {
    backgroundColor: palette.paper, borderRadius: 12, borderWidth: 1,
    borderColor: palette.line, padding: 14, fontSize: 16, color: palette.ink, marginBottom: 12,
  },
  laterHint: { fontSize: 12, color: palette.muted, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
