import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { toFrench } from '../../utils/errors';
import { Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

interface Props {
  onNavigateLogin: () => void;
}

export default function RegisterScreen({ onNavigateLogin }: Props) {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const { signUp, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!email.trim() || !password || !confirm) {
      Alert.alert('Champs requis', 'Veuillez remplir tous les champs.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Erreur', 'Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Mot de passe trop court', 'Minimum 6 caractères.');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    if (error) {
      setLoading(false);
      Alert.alert('Inscription échouée', toFrench(error));
      return;
    }
    // Auto sign-in — navigation is handled automatically by auth state change
    const { error: signInError } = await signIn(email.trim(), password);
    setLoading(false);
    if (signInError) {
      // Fallback: go to login screen
      onNavigateLogin();
    }
    // If signIn succeeded, AuthGate handles navigation automatically — no alert needed
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>Orny</Text>
          <Text style={styles.subtitle}>Créer un compte</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Inscription</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="vous@exemple.com"
            placeholderTextColor={palette.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Min. 6 caractères"
            placeholderTextColor={palette.muted}
            secureTextEntry
          />

          <Text style={styles.label}>Confirmer le mot de passe</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            placeholderTextColor={palette.muted}
            secureTextEntry
          />

          <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
            {loading
              ? <ActivityIndicator color={palette.white} />
              : <Text style={styles.btnText}>Créer mon compte</Text>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={onNavigateLogin} style={styles.link}>
          <Text style={styles.linkText}>Déjà un compte ? <Text style={styles.linkBold}>Se connecter</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.paper },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 36, fontWeight: '800', color: palette.moss },
  subtitle: { fontSize: 15, color: palette.muted, marginTop: 4 },
  card: { backgroundColor: palette.card, borderRadius: 16, padding: 24, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: palette.ink, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: palette.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderColor: palette.line, borderRadius: 10,
    padding: 14, fontSize: 15, color: palette.ink, backgroundColor: palette.paper, marginBottom: 16,
  },
  btn: { backgroundColor: palette.moss, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center' },
  linkText: { color: palette.muted, fontSize: 14 },
  linkBold: { color: palette.moss, fontWeight: '700' },
});
