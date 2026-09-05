import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { getBusinessSnapshot, BusinessSnapshot } from '../../utils/businessData';
import { buildSystemPrompt, buildBriefPrompt, buildDataContext } from '../../utils/coachPrompt';
import { ConfirmDialog } from '../../components/ui';
import { Palette, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { getProfile } from '../../store/profile';
import { LanguageCode, resolveLocale, speak } from '../../utils/voice';

interface Message {
  id: string;
  role: 'ai' | 'user';
  content: string;
  isLoading?: boolean;
}

type ApiMessage = { role: 'user' | 'assistant'; content: string };

// Calls the factory-chat edge function — the Groq key lives server-side only
// (supabase/functions/factory-chat), so this is the one place the client
// ever talks to "the model", and it's always mediated through our own backend.
async function callFactoryChat(
  factoryId: string,
  systemPrompt: string,
  history: ApiMessage[]
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('Session expirée. Reconnectez-vous.');

  const fnUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/factory-chat`;
  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      factory_id: factoryId,
      system_prompt: systemPrompt,
      messages: history,
    }),
  });

  const body = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    throw new Error(body.error ?? `Erreur ${response.status}`);
  }
  if (!body.reply) throw new Error('Réponse vide du serveur');
  return body.reply as string;
}

// Transcribes a recorded question via the factory-voice edge function (Groq
// Whisper server-side, same "client never holds the key" posture as
// callFactoryChat above). Uploads via FormData's { uri, name, type } shape —
// not fetch(uri).blob(), which returns a 0-byte blob for file:// URIs in
// Hermes (same gotcha documented for voice/image messages elsewhere).
async function transcribeAudio(
  factoryId: string,
  fileUri: string
): Promise<{ text: string; language: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('Session expirée. Reconnectez-vous.');

  const form = new FormData();
  form.append('factory_id', factoryId);
  form.append('audio', { uri: fileUri, name: 'question.m4a', type: 'audio/m4a' } as any);

  const fnUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/factory-voice`;
  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const body = await response.json().catch(() => ({} as any));
  if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
  return { text: body.text ?? '', language: body.language ?? null };
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
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const { membership, user } = useAuth();
  const factoryId = membership?.factoryId;
  const factoryName = membership?.factoryName ?? 'Mon Usine';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [snap, setSnap] = useState<BusinessSnapshot | null>(null);
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const apiHistory = useRef<ApiMessage[]>([]);
  const initialized = useRef(false);
  const preferredLanguage = useRef<LanguageCode | null>(null);
  const voiceAutoplay = useRef(false);
  const lastDetectedLanguage = useRef<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useFocusEffect(
    useCallback(() => {
      if (!factoryId || initialized.current) return;
      initialized.current = true;
      generateBrief();
    }, [factoryId])
  );

  useEffect(() => {
    if (!user?.id) return;
    getProfile(user.id).then(p => {
      preferredLanguage.current = p.preferredLanguage;
      voiceAutoplay.current = p.voiceAutoplay;
    });
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
  }, []);

  async function generateBrief() {
    if (!factoryId) return;
    setIsLoading(true);
    const loadingId = 'brief-loading';
    setMessages([{ id: loadingId, role: 'ai', content: '', isLoading: true }]);
    apiHistory.current = [];

    try {
      const snapshot = await getBusinessSnapshot();
      setSnap(snapshot);

      const briefPrompt = buildBriefPrompt(snapshot, factoryName);
      const systemPrompt = buildSystemPrompt(factoryName);

      apiHistory.current = [{ role: 'user', content: briefPrompt }];
      const response = await callFactoryChat(factoryId, systemPrompt, apiHistory.current);
      apiHistory.current.push({ role: 'assistant', content: response });

      setMessages([{ id: loadingId, role: 'ai', content: response, isLoading: false }]);
    } catch (err: any) {
      setMessages([
        {
          id: loadingId,
          role: 'ai',
          content: `❌ Impossible de contacter Orny AI.\n\nErreur : ${err.message ?? 'Inconnue'}\n\nVérifiez votre connexion internet.`,
          isLoading: false,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  // Returns the assistant's reply text (or null on failure) so voice mode
  // can speak it back immediately after a spoken question — typed-message
  // callers simply ignore the return value.
  async function sendMessage(text?: string): Promise<string | null> {
    const msgText = (text ?? input).trim();
    if (!msgText || isLoading || !factoryId) return null;
    setInput('');

    const userId = Date.now().toString();
    const loadingId = `${userId}-reply`;

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: msgText },
      { id: loadingId, role: 'ai', content: '', isLoading: true },
    ]);
    setIsLoading(true);

    try {
      apiHistory.current.push({ role: 'user', content: msgText });
      const systemWithData = buildSystemPrompt(factoryName) + (snap ? '\n\n' + buildDataContext(snap) : '');
      const response = await callFactoryChat(factoryId, systemWithData, apiHistory.current);
      apiHistory.current.push({ role: 'assistant', content: response });

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId ? { ...m, content: response, isLoading: false } : m
        )
      );
      return response;
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId
            ? { ...m, content: `❌ Erreur : ${err.message ?? 'Connexion perdue'}`, isLoading: false }
            : m
        )
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  function handleSpeak(text: string) {
    speak(text, resolveLocale(lastDetectedLanguage.current, preferredLanguage.current));
  }

  async function startRecording() {
    if (isRecording || isLoading || isTranscribing) return;
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setIsRecording(true);
  }

  async function stopRecordingAndSend() {
    if (!isRecording || !factoryId) return;
    setIsRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;

    setIsTranscribing(true);
    try {
      const { text, language } = await transcribeAudio(factoryId, uri);
      lastDetectedLanguage.current = language;
      if (!text) return;
      const reply = await sendMessage(text);
      // A spoken question always gets a spoken answer, regardless of the
      // voiceAutoplay setting — that toggle is about auto-reading TYPED
      // messages too; a voice question implies voice is already how this
      // person wants to use the app.
      if (reply) handleSpeak(reply);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), role: 'ai', content: `❌ ${err.message ?? 'Transcription impossible.'}` },
      ]);
    } finally {
      setIsTranscribing(false);
    }
  }

  async function handleTypedSend(text?: string) {
    const reply = await sendMessage(text);
    if (reply && voiceAutoplay.current) handleSpeak(reply);
  }

  function doRefresh() {
    setShowRefreshConfirm(false);
    initialized.current = false;
    setMessages([]);
    apiHistory.current = [];
    setSnap(null);
    initialized.current = true;
    generateBrief();
  }

  const renderMessage = ({ item }: { item: Message }) => {
    const isAi = item.role === 'ai';
    return (
      <View style={[styles.msgRow, isAi ? styles.msgRowAi : styles.msgRowUser]}>
        {isAi && (
          <View style={styles.avatar}>
            <Ionicons name="sparkles" size={16} color={palette.moss} />
          </View>
        )}
        <View style={[styles.bubble, isAi ? styles.bubbleAi : styles.bubbleUser, item.isLoading && styles.bubbleLoading]}>
          {item.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={palette.moss} />
              <Text style={styles.loadingText}>Orny AI réfléchit...</Text>
            </View>
          ) : (
            <>
              <Text style={isAi ? styles.textAi : styles.textUser}>{item.content}</Text>
              {isAi && (
                <TouchableOpacity onPress={() => handleSpeak(item.content)} style={styles.speakBtn} hitSlop={8}>
                  <Ionicons name="volume-medium-outline" size={16} color={palette.muted} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Orny AI</Text>
          <Text style={styles.headerSub}>
            {snap ? `Données du ${new Date(snap.generatedAt).toLocaleDateString('fr-FR')}` : 'Chargement...'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowRefreshConfirm(true)} style={styles.headerBtn} disabled={isLoading}>
          <Ionicons name="refresh" size={20} color={isLoading ? palette.line : palette.moss} />
        </TouchableOpacity>
      </View>

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
            <ActivityIndicator size="large" color={palette.moss} />
            <Text style={styles.emptyText}>Chargement du bilan quotidien...</Text>
          </View>
        }
      />

      {messages.length > 0 && !isLoading && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickScroll}
          contentContainerStyle={styles.quickContent}
        >
          {QUICK_PROMPTS.map(prompt => (
            <TouchableOpacity key={prompt} style={styles.chip} onPress={() => handleTypedSend(prompt)}>
              <Text style={styles.chipText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.micBtn, isRecording && styles.micBtnActive]}
            onPress={isRecording ? stopRecordingAndSend : startRecording}
            disabled={isLoading || isTranscribing}
          >
            {isTranscribing ? (
              <ActivityIndicator size="small" color={isRecording ? palette.white : palette.moss} />
            ) : (
              <Ionicons
                name={isRecording ? 'stop' : 'mic-outline'}
                size={20}
                color={isRecording ? palette.white : palette.moss}
              />
            )}
          </TouchableOpacity>
        )}
        <TextInput
          style={styles.textInput}
          placeholder={isRecording ? "Parlez à Orny AI..." : "Posez votre question..."}
          placeholderTextColor={palette.muted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => handleTypedSend()}
          editable={!isRecording}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || isLoading) && { opacity: 0.35 }]}
          onPress={() => handleTypedSend()}
          disabled={!input.trim() || isLoading}
        >
          <Ionicons name="send" size={18} color={palette.white} />
        </TouchableOpacity>
      </View>

      <ConfirmDialog
        visible={showRefreshConfirm}
        onClose={() => setShowRefreshConfirm(false)}
        onConfirm={doRefresh}
        title="Rafraîchir le bilan ?"
        message="La conversation sera réinitialisée avec les données actuelles."
        confirmLabel="Rafraîchir"
        cancelLabel="Annuler"
        icon="refresh"
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: palette.card, borderBottomWidth: 1, borderColor: palette.line,
  },
  headerLeft: {},
  headerTitle: { ...typography.screenTitle, color: palette.ink },
  headerSub: { ...typography.caption, color: palette.muted, marginTop: 1 },
  headerBtn: { padding: spacing.sm, borderRadius: radius.sm },

  messageList: { padding: spacing.md, paddingBottom: spacing.sm },
  msgRow: { flexDirection: 'row', marginBottom: spacing.md, alignItems: 'flex-end' },
  msgRowAi: { justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm, flexShrink: 0,
  },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleAi: { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: palette.moss, borderBottomRightRadius: 4 },
  bubbleLoading: { paddingVertical: spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingText: { fontSize: 13, color: palette.muted, fontStyle: 'italic' },
  textAi: { fontSize: 14, color: palette.ink, lineHeight: 21 },
  textUser: { fontSize: 14, color: palette.white, lineHeight: 21 },
  speakBtn: { marginTop: spacing.xs, alignSelf: 'flex-start', padding: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { marginTop: spacing.md, fontSize: 14, color: palette.muted },

  quickScroll: { maxHeight: 44, flexGrow: 0, backgroundColor: palette.paper },
  quickContent: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    backgroundColor: palette.mossSoft, borderRadius: radius.pill,
    borderWidth: 1, borderColor: palette.moss + '40',
  },
  chipText: { fontSize: 12, color: palette.mossDeep, fontWeight: '600' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: palette.card, borderTopWidth: 1, borderColor: palette.line,
    gap: spacing.sm,
  },
  textInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    backgroundColor: palette.paper, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    fontSize: 14, color: palette.ink,
    borderWidth: 1, borderColor: palette.line,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.moss, alignItems: 'center', justifyContent: 'center',
  },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: { backgroundColor: palette.critical },
});
