import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';

const C = {
  primary: '#1D9E75', bg: '#F8F8F6', card: '#FFFFFF',
  muted: '#6B6B66', border: '#E8E8E4', orange: '#EF9F27', red: '#E24B4A',
};

type Tab = 'create' | 'join';

export default function FactorySetupScreen() {
  const { createFactory, requestToJoin, cancelJoinRequest, signOut, pendingRequest } = useAuth();
  const [tab, setTab] = useState<Tab>('create');
  const [factoryName, setFactoryName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);

  async function handleCreate() {
    if (!factoryName.trim()) { Alert.alert('Nom requis', "Entrez le nom de votre usine."); return; }
    setLoading(true);
    const { error } = await createFactory(factoryName.trim());
    setLoading(false);
    if (error) Alert.alert('Erreur', error);
  }

  async function handleJoin() {
    if (!inviteCode.trim()) { Alert.alert('Code requis', "Entrez le code d'invitation."); return; }
    setLoading(true);
    const { error } = await requestToJoin(inviteCode.trim());
    setLoading(false);
    if (error) Alert.alert('Erreur', error);
  }

  async function confirmCancel() {
    setCancelModal(false);
    const { error } = await cancelJoinRequest();
    if (error) Alert.alert('Erreur', error);
  }

  if (pendingRequest) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Modal visible={cancelModal} transparent animationType="fade" onRequestClose={() => setCancelModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Annuler la demande ?</Text>
              <Text style={styles.modalSub}>Vous pourrez envoyer une nouvelle demande à tout moment.</Text>
              <TouchableOpacity style={styles.modalDestructive} onPress={confirmCancel}>
                <Text style={styles.modalDestructiveText}>Oui, annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCancelModal(false)}>
                <Text style={styles.modalCancelText}>Non</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.logo}>Orny</Text>
            <Text style={styles.subtitle}>Demande envoyée</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.waitIconRow}>
              <Ionicons name="time-outline" size={40} color={C.orange} />
            </View>
            <Text style={styles.waitTitle}>En attente d'approbation</Text>
            <Text style={styles.waitDesc}>
              Votre demande a été envoyée à l'administrateur de l'usine.
              Vous serez ajouté dès qu'il l'aura approuvée.
            </Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setCancelModal(true)}>
              <Text style={styles.cancelBtnText}>Annuler ma demande</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={signOut} style={styles.link}>
            <Text style={styles.linkText}>Se déconnecter</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>Orny</Text>
          <Text style={styles.subtitle}>Configurer votre usine</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TouchableOpacity style={[styles.tab, tab === 'create' && styles.tabActive]} onPress={() => setTab('create')}>
              <Text style={[styles.tabText, tab === 'create' && styles.tabTextActive]}>Créer une usine</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'join' && styles.tabActive]} onPress={() => setTab('join')}>
              <Text style={[styles.tabText, tab === 'join' && styles.tabTextActive]}>Rejoindre</Text>
            </TouchableOpacity>
          </View>

          {tab === 'create' ? (
            <View>
              <Text style={styles.desc}>Vous serez administrateur et pourrez inviter des membres.</Text>
              <Text style={styles.label}>Nom de l'usine</Text>
              <TextInput style={styles.input} value={factoryName} onChangeText={setFactoryName}
                placeholder="ex: Ma Fabrique" placeholderTextColor={C.muted} />
              <TouchableOpacity style={styles.btn} onPress={handleCreate} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Créer l'usine</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.desc}>
                Entrez le code partagé par l'administrateur. Il vous attribuera un rôle après approbation.
              </Text>

              <Text style={styles.label}>Code d'invitation</Text>
              <TextInput style={[styles.input, styles.codeInput]} value={inviteCode} onChangeText={setInviteCode}
                placeholder="ex: A1B2C3D4" placeholderTextColor={C.muted}
                autoCapitalize="characters" autoCorrect={false} />

              <TouchableOpacity style={styles.btn} onPress={handleJoin} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Envoyer la demande</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={signOut} style={styles.link}>
          <Text style={styles.linkText}>Se déconnecter</Text>
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
  tabs: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 10, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: C.card, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: C.muted },
  tabTextActive: { color: C.primary },
  desc: { fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 14, fontSize: 15, color: '#1A1A18', backgroundColor: C.bg, marginBottom: 16 },
  codeInput: { fontSize: 20, fontWeight: '700', letterSpacing: 4, textAlign: 'center' },
  btn: { backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center' },
  linkText: { color: C.muted, fontSize: 14 },
  // waiting state
  waitIconRow: { alignItems: 'center', marginBottom: 16 },
  waitTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A18', textAlign: 'center', marginBottom: 12 },
  waitDesc: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  cancelBtn: { borderWidth: 1, borderColor: C.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText: { color: C.red, fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A18', marginBottom: 6 },
  modalSub: { fontSize: 14, color: C.muted, marginBottom: 20 },
  modalDestructive: { backgroundColor: C.red, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  modalDestructiveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancel: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCancelText: { color: C.muted, fontWeight: '600', fontSize: 15 },
});
