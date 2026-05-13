import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { toFrench } from '../../utils/errors';

const C = {
  primary: '#1D9E75', bg: '#F8F8F6', card: '#FFFFFF',
  muted: '#6B6B66', border: '#E8E8E4', red: '#E24B4A',
};

interface Props { onNavigateRegister: () => void; }

export default function LoginScreen({ onNavigateRegister }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) { Alert.alert('Champs requis', 'Veuillez remplir tous les champs.'); return; }
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) Alert.alert('Connexion échouée', toFrench(error));
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);
    if (error) Alert.alert('Connexion Google échouée', toFrench(error));
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>Orny</Text>
          <Text style={styles.subtitle}>Gestion d'usine</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Connexion</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail}
            placeholder="vous@exemple.com" placeholderTextColor={C.muted}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword}
            placeholder="••••••••" placeholderTextColor={C.muted} secureTextEntry />

          <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Se connecter</Text>}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.oauthBtn} onPress={handleGoogle} disabled={googleLoading}>
            {googleLoading
              ? <ActivityIndicator color={C.muted} />
              : <>
                  <Ionicons name="logo-google" size={20} color="#EA4335" />
                  <Text style={styles.oauthText}>Continuer avec Google</Text>
                </>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={onNavigateRegister} style={styles.link}>
          <Text style={styles.linkText}>Pas encore de compte ? <Text style={styles.linkBold}>S'inscrire</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 36, fontWeight: '800', color: C.primary },
  subtitle: { fontSize: 15, color: C.muted, marginTop: 4 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 24, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#1A1A18', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 14, fontSize: 15, color: '#1A1A18', backgroundColor: C.bg, marginBottom: 16 },
  btn: { backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.muted, fontSize: 13, marginHorizontal: 12 },
  oauthBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 12, backgroundColor: C.card },
  appleBtn: { backgroundColor: '#000', borderColor: '#000' },
  oauthText: { fontSize: 15, fontWeight: '600', color: '#1A1A18' },
  link: { alignItems: 'center' },
  linkText: { color: C.muted, fontSize: 14 },
  linkBold: { color: C.primary, fontWeight: '700' },
});
