import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import { getBusinessSnapshot, BusinessSnapshot } from '../../utils/businessData';
import { buildSystemPrompt, buildBriefPrompt, buildDataContext } from '../../utils/coachPrompt';

const API_KEY_STORAGE = 'anthropic_api_key';

const C = {
  primary: '#1D9E75',
  primaryDark: '#167A5B',
  bg: '#F8F8F6',
  card: '#FFFFFF',
  text: '#1A1A18',
  muted: '#6B6B66',
  border: '#E8E8E4',
  red: '#E24B4A',
  coachBg: '#E8F6F0',
  userBg: '#1D9E75',
};

interface Message {
  id: string;
  role: 'coach' | 'user';
  content: string;
  isLoading?: boolean;
}

type ApiMessage = { role: 'user' | 'assistant'; content: string };

async function callClaude(
  apiKey: string,
  history: ApiMessage[],
  systemPrompt: string
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: history,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error?.message ?? `Erreur API ${response.status}`);
  }

  const data = await response.json();
  const text = (data as any).content?.[0]?.text;
  if (!text) throw new Error('Réponse vide du serveur');
  return text as string;
}

const QUICK_PROMPTS = [
  'Où est mon goulot ?',
  'Analyse ma trésorerie',
  'Mes clients à risque ?',
  'Plan action cette semaine',
  'Comment monter mes prix ?',
  'Réduire mes créances',
];

export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useAuth();
  const factoryName = membership?.factoryName ?? 'Mon Usine';
  const coachName = `${factoryName} Coach`;
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [snap, setSnap] = useState<BusinessSnapshot | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const apiHistory = useRef<ApiMessage[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(API_KEY_STORAGE).then(key => {
      if (key) setApiKey(key);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!apiKey || initialized.current) return;
      initialized.current = true;
      generateBrief();
    }, [apiKey])
  );

  async function generateBrief() {
    setIsLoading(true);
    const loadingId = 'brief-loading';
    setMessages([{ id: loadingId, role: 'coach', content: '', isLoading: true }]);
    apiHistory.current = [];

    try {
      const snapshot = await getBusinessSnapshot();
      setSnap(snapshot);

      const briefPrompt = buildBriefPrompt(snapshot, factoryName);
      const systemPrompt = buildSystemPrompt(factoryName);

      apiHistory.current = [{ role: 'user', content: briefPrompt }];
      const response = await callClaude(apiKey!, apiHistory.current, systemPrompt);
      apiHistory.current.push({ role: 'assistant', content: response });

      setMessages([{ id: loadingId, role: 'coach', content: response, isLoading: false }]);
    } catch (err: any) {
      setMessages([
        {
          id: loadingId,
          role: 'coach',
          content: `❌ Impossible de contacter le coach.\n\nErreur : ${err.message ?? 'Inconnue'}\n\nVérifiez votre clé API et votre connexion internet.`,
          isLoading: false,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage(text?: string) {
    const msgText = (text ?? input).trim();
    if (!msgText || isLoading || !apiKey) return;
    setInput('');

    const userId = Date.now().toString();
    const loadingId = `${userId}-reply`;

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: msgText },
      { id: loadingId, role: 'coach', content: '', isLoading: true },
    ]);
    setIsLoading(true);

    try {
      apiHistory.current.push({ role: 'user', content: msgText });
      const systemWithData = buildSystemPrompt(factoryName) + (snap ? '\n\n' + buildDataContext(snap) : '');
      const response = await callClaude(apiKey!, apiHistory.current, systemWithData);
      apiHistory.current.push({ role: 'assistant', content: response });

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId ? { ...m, content: response, isLoading: false } : m
        )
      );
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? { ...m, content: `❌ Erreur : ${err.message ?? 'Connexion perdue'}`, isLoading: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleRefresh() {
    Alert.alert('Rafraîchir le bilan ?', 'La conversation sera réinitialisée avec les données actuelles.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Rafraîchir',
        onPress: () => {
          initialized.current = false;
          setMessages([]);
          apiHistory.current = [];
          setSnap(null);
          initialized.current = true;
          generateBrief();
        },
      },
    ]);
  }

  function handleResetKey() {
    Alert.alert('Changer la clé API ?', 'La conversation sera effacée.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        style: 'destructive',
        onPress: () => {
          AsyncStorage.removeItem(API_KEY_STORAGE);
          setApiKey(null);
          setMessages([]);
          setSnap(null);
          apiHistory.current = [];
          initialized.current = false;
        },
      },
    ]);
  }

  function saveApiKey() {
    const key = apiKeyInput.trim();
    if (!key) return;
    AsyncStorage.setItem(API_KEY_STORAGE, key);
    setApiKey(key);
    setApiKeyInput('');
  }

  const renderMessage = ({ item }: { item: Message }) => {
    const isCoach = item.role === 'coach';
    return (
      <View style={[styles.msgRow, isCoach ? styles.msgRowCoach : styles.msgRowUser]}>
        {isCoach && (
          <View style={styles.avatar}>
            <Text style={styles.avatarEmoji}>🧠</Text>
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isCoach ? styles.bubbleCoach : styles.bubbleUser,
            item.isLoading && styles.bubbleLoading,
          ]}
        >
          {item.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>{coachName} analyse...</Text>
            </View>
          ) : (
            <Text style={isCoach ? styles.textCoach : styles.textUser}>{item.content}</Text>
          )}
        </View>
      </View>
    );
  };

  // ── API Key setup ──────────────────────────────────────────────
  if (!apiKey) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.setupHeader}>
          <View style={styles.setupIcon}>
            <Text style={{ fontSize: 36 }}>🧠</Text>
          </View>
          <Text style={styles.setupTitle}>{coachName}</Text>
          <Text style={styles.setupTagline}>Hormozi · Goldratt · Claude</Text>
          <Text style={styles.setupDesc}>
            Votre coach IA analyse les données de l'usine en temps réel et vous dit exactement quoi faire pour améliorer vos résultats.
          </Text>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.setupLabel}>Clé API Anthropic</Text>
          <Text style={styles.setupHint}>
            Entrez votre clé API (sk-ant-…). Elle est stockée uniquement sur cet appareil.
          </Text>
          <View style={styles.apiInputRow}>
            <TextInput
              style={styles.apiInput}
              placeholder="sk-ant-api03-..."
              placeholderTextColor={C.muted}
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowKey(v => !v)} style={styles.eyeBtn}>
              <Ionicons name={showKey ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.activateBtn, !apiKeyInput.trim() && { opacity: 0.45 }]}
            onPress={saveApiKey}
            disabled={!apiKeyInput.trim()}
          >
            <Ionicons name="flash" size={18} color="#FFF" style={{ marginRight: 6 }} />
            <Text style={styles.activateBtnText}>Activer {coachName}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main coach chat ────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>{coachName}</Text>
          <Text style={styles.headerSub}>
            {snap
              ? `Données du ${new Date(snap.generatedAt).toLocaleDateString('fr-FR')}`
              : 'Chargement...'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleRefresh} style={styles.headerBtn} disabled={isLoading}>
            <Ionicons name="refresh" size={20} color={isLoading ? C.border : C.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleResetKey} style={styles.headerBtn}>
            <Ionicons name="key-outline" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.emptyText}>Chargement du bilan quotidien...</Text>
          </View>
        }
      />

      {/* Quick prompts */}
      {messages.length > 0 && !isLoading && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickScroll}
          contentContainerStyle={styles.quickContent}
        >
          {QUICK_PROMPTS.map(prompt => (
            <TouchableOpacity
              key={prompt}
              style={styles.chip}
              onPress={() => sendMessage(prompt)}
            >
              <Text style={styles.chipText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Input */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.textInput}
          placeholder="Posez votre question..."
          placeholderTextColor={C.muted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => sendMessage()}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || isLoading) && { opacity: 0.35 }]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || isLoading}
        >
          <Ionicons name="send" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // ── Setup ─────────────────────────────────────────────────────
  setupHeader: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48, paddingBottom: 24 },
  setupIcon: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: C.coachBg, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  setupTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 4 },
  setupTagline: { fontSize: 13, color: C.primary, fontWeight: '600', marginBottom: 12, letterSpacing: 0.5 },
  setupDesc: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
  setupCard: {
    margin: 16, backgroundColor: C.card, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, padding: 20,
  },
  setupLabel: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
  setupHint: { fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 18 },
  apiInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    backgroundColor: C.bg, marginBottom: 16, paddingHorizontal: 14,
  },
  apiInput: { flex: 1, paddingVertical: 14, fontSize: 14, color: C.text },
  eyeBtn: { padding: 4 },
  activateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
  },
  activateBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  // ── Header ────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border,
  },
  headerLeft: {},
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 8, borderRadius: 10 },

  // ── Messages ──────────────────────────────────────────────────
  messageList: { padding: 12, paddingBottom: 8 },
  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowCoach: { justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: C.coachBg, alignItems: 'center', justifyContent: 'center',
    marginRight: 8, flexShrink: 0,
  },
  avatarEmoji: { fontSize: 16 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleCoach: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: C.userBg, borderBottomRightRadius: 4 },
  bubbleLoading: { paddingVertical: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 13, color: C.muted, fontStyle: 'italic' },
  textCoach: { fontSize: 14, color: C.text, lineHeight: 21 },
  textUser: { fontSize: 14, color: '#FFFFFF', lineHeight: 21 },

  // ── Empty ─────────────────────────────────────────────────────
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { marginTop: 14, fontSize: 14, color: C.muted },

  // ── Quick prompts ─────────────────────────────────────────────
  quickScroll: { maxHeight: 44, flexGrow: 0, backgroundColor: C.bg },
  quickContent: { paddingHorizontal: 12, gap: 8, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: C.coachBg, borderRadius: 20,
    borderWidth: 1, borderColor: '#B8E4D4',
  },
  chipText: { fontSize: 12, color: C.primaryDark, fontWeight: '600' },

  // ── Input bar ─────────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: C.card, borderTopWidth: 1, borderColor: C.border,
    gap: 8,
  },
  textInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    backgroundColor: C.bg, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
});
