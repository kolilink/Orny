import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import { buildSystemPrompt, buildDataContext, BRIEF_INSTRUCTIONS } from '../../utils/coachPrompt';
import {
  listConversations, createConversation, getMessages, addMessage,
  renameConversationFromFirstMessage, deleteConversation,
} from '../../store/coach';
import { CoachConversation } from '../../types';
import { AppModal, Text } from '../../components/ui';
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

// Only the most recent messages are ever resent to the model — see
// openConversation's own comment on why this stays well under
// factory-chat's MAX_MESSAGES ceiling even for a conversation revisited
// many times over weeks.
const API_HISTORY_LIMIT = 30;

// "Bilan du jour" is first and visually distinct — it's the one quick
// prompt that asks for a full structured analysis (see BRIEF_INSTRUCTIONS)
// instead of a direct answer; the rest are ordinary questions.
const QUICK_PROMPTS = [
  'Bilan du jour',
  'Où est mon goulot ?',
  'Analyse ma trésorerie',
  'Mes clients à risque ?',
  'Plan action cette semaine',
  'Comment monter mes prix ?',
  'Réduire mes créances',
];

// ── AI reply formatting ────────────────────────────────────────────
// The model replies using the convention set in coachPrompt.ts's "Mise en
// forme": a section is one of 4 fixed icons + a **bold** title alone on its
// own line, followed by body text with 1-3 **bold** key figures. Rendering
// item.content as one flat <Text> shows the literal ** characters and reads
// as an undifferentiated wall of text (the "weird" look) — this turns the
// same string into real section headers + inline bold, nothing invented
// beyond what the model is already asked to produce.
const SECTION_ICONS = ['🔍', '🚧', '⚡', '📈'];

function splitSectionHeader(line: string): { icon: string; title: string; rest: string } | null {
  const trimmed = line.trim();
  const icon = SECTION_ICONS.find(i => trimmed.startsWith(i));
  if (!icon) return null;
  let after = trimmed.slice(icon.length).trim().replace(/^\*\*/, '');
  const boldEnd = after.indexOf('**');
  if (boldEnd !== -1) {
    return { icon, title: after.slice(0, boldEnd).trim(), rest: after.slice(boldEnd + 2).replace(/^[\s:—-]+/, '') };
  }
  const dashIdx = after.search(/\s[:—-]\s/);
  return dashIdx !== -1
    ? { icon, title: after.slice(0, dashIdx).trim(), rest: after.slice(dashIdx + 3).trim() }
    : { icon, title: after, rest: '' };
}

// Splits one line on **bold** markers and renders each segment, so a figure
// the model wrapped in ** actually shows bold instead of literal asterisks.
function InlineLine({ line, style, boldStyle }: { line: string; style: any; boldStyle: any }) {
  if (!line) return null;
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={i} style={boldStyle}>{part.slice(2, -2)}</Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

function AiReplyContent({ content, styles }: { content: string; styles: any }) {
  const blocks = content.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map(l => l.trim());
        const header = splitSectionHeader(lines[0]);
        if (header) {
          const bodyLines = [header.rest, ...lines.slice(1)].filter(Boolean);
          return (
            <View key={bi} style={bi > 0 ? styles.aiSectionSpacing : undefined}>
              <View style={styles.aiSectionHeader}>
                <Text style={styles.aiSectionIcon}>{header.icon}</Text>
                <Text style={styles.aiSectionTitle}>{header.title}</Text>
              </View>
              {bodyLines.map((l, li) => (
                <InlineLine key={li} line={l} style={styles.textAi} boldStyle={styles.textAiBold} />
              ))}
            </View>
          );
        }
        return (
          <View key={bi} style={bi > 0 ? styles.aiSectionSpacing : undefined}>
            {lines.filter(Boolean).map((l, li) => (
              <InlineLine key={li} line={l} style={styles.textAi} boldStyle={styles.textAiBold} />
            ))}
          </View>
        );
      })}
    </>
  );
}

function conversationLabel(c: CoachConversation): string {
  return c.title?.trim() || 'Nouvelle conversation';
}

function relativeDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays <= 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function CoachScreen() {
  const { palette } = useTheme();
  const styles = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { membership, user } = useAuth();
  const factoryId = membership?.factoryId;
  const factoryName = membership?.factoryName ?? 'Mon Usine';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [snap, setSnap] = useState<BusinessSnapshot | null>(null);

  // ── Sessions — a real, named conversation per (factory, user), not one
  // ephemeral in-memory chat gone the moment the screen unmounts. See
  // store/coach.ts + db/update25.sql.
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState(false);
  const [screenReady, setScreenReady] = useState(false);
  const [deleteConvoTarget, setDeleteConvoTarget] = useState<CoachConversation | null>(null);

  // Title + a "New chat"/"History" pair live in the native header (this
  // screen has one — see the rule in navigation/index.tsx), not a second
  // title row duplicating it.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setHistoryModal(true)} disabled={isLoading} hitSlop={8}>
            <Ionicons name="time-outline" size={22} color={isLoading ? palette.line : palette.moss} />
          </TouchableOpacity>
          <TouchableOpacity onPress={startNewChat} disabled={isLoading} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={isLoading ? palette.line : palette.moss} />
          </TouchableOpacity>
        </View>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isLoading, palette.line, palette.moss]);
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
      bootstrap();
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

  // Cold open: silently fetch the business snapshot (grounding data — no
  // model call, nothing shown to the user yet) and the conversation list,
  // then resume exactly where the user left off — their most recent
  // session — or, if they've never talked to Claude before, a real empty
  // welcome state. Never fires a model call on its own: Claude only ever
  // speaks once actually asked something.
  async function bootstrap() {
    if (!factoryId) return;
    setScreenReady(false);
    const [snapshot, convos] = await Promise.all([getBusinessSnapshot(), listConversations(factoryId)]);
    setSnap(snapshot);
    setConversations(convos);
    if (convos.length > 0) {
      await openConversation(convos[0]);
    } else {
      setActiveConversationId(null);
      setMessages([]);
      apiHistory.current = [];
    }
    setScreenReady(true);
  }

  async function openConversation(convo: CoachConversation) {
    setActiveConversationId(convo.id);
    const msgs = await getMessages(convo.id);
    const mapped: Message[] = msgs.map(m => ({ id: m.id, role: m.role === 'assistant' ? 'ai' : 'user', content: m.content }));
    setMessages(mapped);
    // The full history always shows in the UI, but only the most recent
    // messages are resent to the model — a conversation revisited many
    // times over weeks would otherwise eventually hit factory-chat's own
    // MAX_MESSAGES ceiling with no way to keep using it short of deleting
    // the whole thread. Recent context is what actually matters for a
    // reply anyway.
    apiHistory.current = mapped
      .slice(-API_HISTORY_LIMIT)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
    setHistoryModal(false);
  }

  // Never destructive — the previous conversation is already safely saved
  // and reachable from "Historique", so this needs no confirmation, unlike
  // the old "Rafraîchir" button it replaces (which used to permanently
  // wipe the only copy of the conversation).
  function startNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    apiHistory.current = [];
    setHistoryModal(false);
  }

  async function confirmDeleteConversation() {
    if (!deleteConvoTarget) return;
    const id = deleteConvoTarget.id;
    await deleteConversation(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
      apiHistory.current = [];
    }
    setDeleteConvoTarget(null);
  }

  // Returns the assistant's reply text (or null on failure) so voice mode
  // can speak it back immediately after a spoken question — typed-message
  // callers simply ignore the return value. isBriefRequest only ever comes
  // from the "Bilan du jour" quick prompt — it steers the SYSTEM prompt
  // toward the full structured analysis; the user's own message stays the
  // plain, honest "Bilan du jour" they actually tapped.
  async function sendMessage(text?: string, isBriefRequest = false): Promise<string | null> {
    const msgText = (text ?? input).trim();
    if (!msgText || isLoading || !factoryId) return null;
    setInput('');

    // A conversation is only ever created the moment there's a real first
    // message to put in it — never eagerly on screen open, never for an
    // abandoned empty session.
    let conversationId = activeConversationId;
    const isFirstMessageOfConversation = !conversationId;
    if (!conversationId) {
      const convo = await createConversation(factoryId);
      if (!convo) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '❌ Impossible de démarrer une nouvelle conversation. Vérifiez votre connexion.' }]);
        return null;
      }
      conversationId = convo.id;
      setActiveConversationId(convo.id);
      setConversations(prev => [convo, ...prev]);
    }

    const userMsgId = Date.now().toString();
    const loadingId = `${userMsgId}-reply`;

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: msgText },
      { id: loadingId, role: 'ai', content: '', isLoading: true },
    ]);
    setIsLoading(true);

    try {
      apiHistory.current.push({ role: 'user', content: msgText });
      // Keep the window bounded even within one long, never-closed session
      // — not just at reopen time (see API_HISTORY_LIMIT's own comment).
      if (apiHistory.current.length > API_HISTORY_LIMIT) {
        apiHistory.current = apiHistory.current.slice(-API_HISTORY_LIMIT);
      }
      let systemWithData = buildSystemPrompt(factoryName) + (snap ? '\n\n' + buildDataContext(snap) : '');
      if (isBriefRequest) systemWithData += '\n\n' + BRIEF_INSTRUCTIONS;
      const response = await callFactoryChat(factoryId, systemWithData, apiHistory.current);
      apiHistory.current.push({ role: 'assistant', content: response });

      setMessages(prev =>
        prev.map(m => (m.id === loadingId ? { ...m, content: response, isLoading: false } : m))
      );

      // Persist both turns — best-effort. A failed save doesn't undo the
      // reply already on screen; it just means this exchange won't be
      // there next time the conversation is reopened.
      const convoId = conversationId;
      addMessage(convoId, 'user', msgText).catch(() => {});
      addMessage(convoId, 'assistant', response).catch(() => {});
      if (isFirstMessageOfConversation) {
        renameConversationFromFirstMessage(convoId, msgText)
          .then(() => setConversations(prev => prev.map(c => (c.id === convoId ? { ...c, title: msgText.slice(0, 60) } : c))))
          .catch(() => {});
      } else {
        // Bump this conversation to the top of the local list, matching
        // the store's own last_message_at touch, without a full refetch.
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === convoId);
          if (idx <= 0) return prev;
          const next = [...prev];
          const [moved] = next.splice(idx, 1);
          next.unshift(moved);
          return next;
        });
      }

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

  async function handleTypedSend(text?: string, isBriefRequest = false) {
    const reply = await sendMessage(text, isBriefRequest);
    if (reply && voiceAutoplay.current) handleSpeak(reply);
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
              <Text style={styles.loadingText}>Claude réfléchit...</Text>
            </View>
          ) : (
            <>
              {isAi ? (
                <AiReplyContent content={item.content} styles={styles} />
              ) : (
                <Text style={styles.textUser}>{item.content}</Text>
              )}
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {!!snap && (
        <Text style={styles.headerSub}>
          Données du {new Date(snap.generatedAt).toLocaleDateString('fr-FR')}
        </Text>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          !screenReady ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={palette.moss} />
              <Text style={styles.emptyText}>Chargement...</Text>
            </View>
          ) : (
            // A real welcome, not an unsolicited analysis — Claude only
            // ever speaks once actually asked something (see bootstrap()).
            <View style={styles.empty}>
              <View style={styles.welcomeAvatar}>
                <Ionicons name="sparkles" size={22} color={palette.moss} />
              </View>
              <Text style={styles.emptyTitle}>Bonjour 👋</Text>
              <Text style={styles.emptyText}>
                Posez une question sur {factoryName}, ou choisissez une suggestion ci-dessous.
              </Text>
            </View>
          )
        }
      />

      {!isLoading && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickScroll}
          contentContainerStyle={styles.quickContent}
        >
          {QUICK_PROMPTS.map(prompt => (
            <TouchableOpacity
              key={prompt}
              style={[styles.chip, prompt === 'Bilan du jour' && styles.chipBrief]}
              onPress={() => handleTypedSend(prompt, prompt === 'Bilan du jour')}
            >
              <Text style={[styles.chipText, prompt === 'Bilan du jour' && styles.chipTextBrief]}>{prompt}</Text>
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
          placeholder={isRecording ? "Parlez à Claude..." : "Posez votre question..."}
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

      {/* ── Historique — every past session, most recent first. The delete
          confirmation is this SAME modal's own internal view (swapped via
          deleteConvoTarget), not a second stacked AppModal — ConfirmDialog
          is itself built on AppModal, and opening one while this one is
          already visible would risk the exact "two native modals briefly
          stacked" glitch fixed in Production's actions menu (see CLAUDE.md). ── */}
      <AppModal
        visible={historyModal}
        onClose={() => { setHistoryModal(false); setDeleteConvoTarget(null); }}
        title={deleteConvoTarget ? 'Supprimer cette conversation ?' : 'Historique'}
        showCloseButton={!deleteConvoTarget}
      >
        {deleteConvoTarget ? (
          <View style={styles.confirmWrap}>
            <Ionicons name="trash-outline" size={32} color={palette.critical} style={{ alignSelf: 'center', marginBottom: spacing.md }} />
            <Text style={styles.confirmMessage}>
              "{conversationLabel(deleteConvoTarget)}" sera définitivement supprimée.
            </Text>
            <TouchableOpacity style={styles.confirmDangerBtn} onPress={confirmDeleteConversation}>
              <Text style={styles.confirmDangerText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setDeleteConvoTarget(null)}>
              <Text style={styles.confirmCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        ) : conversations.length === 0 ? (
          <Text style={styles.emptyText}>Aucune conversation pour l'instant.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 420 }}>
            {conversations.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.historyRow, i > 0 && styles.historyRowDivider]}
                onPress={() => openConversation(c)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTitle} numberOfLines={1}>{conversationLabel(c)}</Text>
                  <Text style={styles.historyDate}>{relativeDay(c.lastMessageAt)}</Text>
                </View>
                {c.id === activeConversationId && (
                  <Ionicons name="checkmark-circle" size={18} color={palette.moss} style={{ marginRight: 8 }} />
                )}
                <TouchableOpacity onPress={() => setDeleteConvoTarget(c)} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={17} color={palette.critical} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },

  headerActions: { flexDirection: 'row', gap: 18, alignItems: 'center' },

  headerSub: {
    ...typography.caption, color: palette.muted, textAlign: 'center',
    paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },

  messageList: { padding: spacing.md, paddingBottom: spacing.sm, flexGrow: 1 },
  msgRow: { flexDirection: 'row', marginBottom: spacing.md, alignItems: 'flex-end' },
  msgRowAi: { justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: palette.mossSoft, alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm, flexShrink: 0,
  },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleAi: { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 4, paddingVertical: spacing.md },
  bubbleUser: { backgroundColor: palette.moss, borderBottomRightRadius: 4 },
  bubbleLoading: { paddingVertical: spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingText: { fontSize: 13, color: palette.muted, fontStyle: 'italic' },
  textAi: { fontSize: 14, color: palette.ink, lineHeight: 21 },
  textAiBold: { fontWeight: '700', color: palette.ink },
  textUser: { fontSize: 14, color: palette.white, lineHeight: 21 },
  speakBtn: { marginTop: spacing.sm, alignSelf: 'flex-start', padding: 2 },

  // AI section headers (🔍 Diagnostic, 🚧 Goulot principal, ...) — see
  // AiReplyContent above. A small uppercase label with its icon, separated
  // from the previous section by real vertical space, so a multi-section
  // reply reads as distinct scannable blocks instead of one long paragraph.
  aiSectionSpacing: { marginTop: spacing.md },
  aiSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  aiSectionIcon: { fontSize: 13 },
  aiSectionTitle: {
    fontSize: 12, fontWeight: '700', color: palette.mossDeep,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: spacing.xl },
  welcomeAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: palette.mossSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: palette.ink, marginBottom: spacing.xs },
  emptyText: { marginTop: spacing.sm, fontSize: 14, color: palette.muted, textAlign: 'center' },

  quickScroll: { maxHeight: 44, flexGrow: 0, backgroundColor: palette.paper },
  quickContent: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    backgroundColor: palette.mossSoft, borderRadius: radius.pill,
    borderWidth: 1, borderColor: palette.moss + '40',
  },
  // Not a solid palette.moss fill + white text — measured contrast on the
  // real token values: ~2.5:1 in light mode, ~1.9:1 in dark mode, both well
  // under WCAG's 4.5:1 minimum for text this small (12px). `moss` is tuned
  // to read as a vivid accent against a neutral page background, not as a
  // fill dark/light enough for white text on top of it — a real, provable
  // legibility bug, not just "make it look nicer." Kept visually distinct
  // from a plain chip via a bold, fully-opaque border (vs. the regular
  // chip's 25%-opacity one) instead of an inverted fill, so it still stands
  // out while reusing the same mossSoft/mossDeep pairing already proven
  // readable in both themes (~4.8:1 light, ~6.4:1 dark).
  chipBrief: { backgroundColor: palette.mossSoft, borderColor: palette.moss, borderWidth: 2 },
  chipText: { fontSize: 12, color: palette.mossDeep, fontWeight: '600' },
  chipTextBrief: { fontWeight: '700' },

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

  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  historyRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  historyTitle: { fontSize: 15, fontWeight: '600', color: palette.ink },
  historyDate: { fontSize: 12, color: palette.muted, marginTop: 2 },

  // Delete-conversation confirm — this modal's own internal view (see the
  // comment above it), not the shared ConfirmDialog component (which is
  // itself an AppModal, and stacking one on top of this already-open one
  // is exactly the bug class fixed elsewhere this session).
  confirmWrap: { paddingVertical: spacing.sm },
  confirmMessage: { ...typography.body, color: palette.muted, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },
  confirmDangerBtn: {
    borderRadius: radius.md, height: 52, backgroundColor: palette.critical,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  confirmDangerText: { color: palette.white, fontSize: 16, fontWeight: '700' },
  confirmCancelBtn: {
    borderRadius: radius.md, height: 52, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmCancelText: { fontSize: 16, color: palette.muted, fontWeight: '600' },
});
