import { supabase } from '../lib/supabase';
import { CoachConversation, CoachMessage } from '../types';

// Claude conversations — deliberately NOT offline-cached like every other
// store in this app. Talking to the AI already requires a live network
// call (the Groq round trip via factory-chat), so there's no real offline
// use case to build a cache for — same posture as the sibling Patron app's
// own Alpha advisor, which reads/writes chat history live too.

function mapConversation(r: any): CoachConversation {
  return {
    id: r.id,
    factory_id: r.factory_id,
    user_id: r.user_id,
    title: r.title,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
  };
}

function mapMessage(r: any): CoachMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  };
}

export const listConversations = async (factoryId: string): Promise<CoachConversation[]> => {
  const { data, error } = await supabase
    .from('coach_conversations')
    .select('*')
    .eq('factory_id', factoryId)
    .order('last_message_at', { ascending: false });
  if (error || !data) return [];
  return data.map(mapConversation);
};

export const createConversation = async (factoryId: string): Promise<CoachConversation | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('coach_conversations')
    .insert({ factory_id: factoryId, user_id: user.id })
    .select()
    .single();
  if (error || !data) return null;
  return mapConversation(data);
};

export const getMessages = async (conversationId: string): Promise<CoachMessage[]> => {
  const { data, error } = await supabase
    .from('coach_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map(mapMessage);
};

export const addMessage = async (
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<CoachMessage | null> => {
  const { data, error } = await supabase
    .from('coach_messages')
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single();
  if (error || !data) return null;
  // Keeps the conversation list sorted by real recency — best-effort, a
  // failed touch doesn't invalidate the message that already saved.
  supabase.from('coach_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
    .then(({ error: touchError }) => { if (touchError) console.warn('coach_conversations touch error', touchError.message); });
  return mapMessage(data);
};

// A short, human title derived from the first real question — the same
// cheap, no-extra-LLM-call approach most chat apps use for a session list,
// rather than spending a model call just to name the thread.
export const renameConversationFromFirstMessage = async (conversationId: string, firstMessage: string): Promise<void> => {
  const title = firstMessage.trim().slice(0, 60);
  await supabase.from('coach_conversations').update({ title }).eq('id', conversationId);
};

export const deleteConversation = async (conversationId: string): Promise<void> => {
  await supabase.from('coach_conversations').delete().eq('id', conversationId);
};
