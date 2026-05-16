import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { setCurrentFactory, clearCurrentFactory } from '../store/context';

WebBrowser.maybeCompleteAuthSession();

export type UserRole = 'admin' | 'employee' | 'investor';

export interface FactoryMembership {
  factoryId: string;
  factoryName: string;
  role: UserRole;
}

export interface MemberDisplay {
  memberId: string;
  userId: string;
  displayName: string;
  email: string;
  role: UserRole;
  isCurrentUser: boolean;
}

export interface PendingRequest {
  id: string;
  factoryId: string;
}

export interface JoinRequestDisplay {
  id: string;
  userId: string;
  userEmail: string;
  createdAt: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  membership: FactoryMembership | null;
  allMemberships: FactoryMembership[];
  pendingRequest: PendingRequest | null;
  loading: boolean;
  switchFactory: (factoryId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  createFactory: (name: string) => Promise<{ error: string | null }>;
  regenerateInviteCode: () => Promise<{ error: string | null }>;
  getInviteCode: () => Promise<string | null>;
  requestToJoin: (inviteCode: string) => Promise<{ error: string | null }>;
  cancelJoinRequest: () => Promise<{ error: string | null }>;
  refreshMembership: () => Promise<void>;
  getMembers: () => Promise<MemberDisplay[]>;
  updateMemberRole: (userId: string, role: UserRole) => Promise<{ error: string | null }>;
  removeMember: (userId: string) => Promise<{ error: string | null }>;
  getPendingRequests: () => Promise<JoinRequestDisplay[]>;
  approveJoinRequest: (requestId: string, userId: string, role: UserRole) => Promise<{ error: string | null }>;
  rejectJoinRequest: (requestId: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_FACTORY_KEY = 'active_factory_id';

async function loadAllMemberships(userId: string): Promise<FactoryMembership[]> {
  const { data } = await supabase
    .from('factory_members')
    .select('factory_id, role, factories(id, name)')
    .eq('user_id', userId);
  if (!data) return [];
  return data.map((r) => {
    const factory = (r as any).factories;
    return { factoryId: factory.id, factoryName: factory.name, role: r.role as UserRole };
  });
}

async function loadPendingRequest(userId: string): Promise<PendingRequest | null> {
  const { data } = await supabase
    .from('join_requests')
    .select('id, factory_id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, factoryId: data.factory_id };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<FactoryMembership | null>(null);
  const [allMemberships, setAllMemberships] = useState<FactoryMembership[]>([]);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);

  async function applySession(s: Session | null) {
    setSession(s);
    setUser(s?.user ?? null);
    if (s?.user) {
      const all = await Promise.race([
        loadAllMemberships(s.user.id),
        new Promise<FactoryMembership[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]);
      setAllMemberships(all);
      if (all.length > 0) {
        const savedId = await AsyncStorage.getItem(ACTIVE_FACTORY_KEY);
        const active = all.find((m) => m.factoryId === savedId) ?? all[0];
        setMembership(active);
        setCurrentFactory(active.factoryId);
        setPendingRequest(null);
      } else {
        setMembership(null);
        clearCurrentFactory();
        const pr = await Promise.race([
          loadPendingRequest(s.user.id),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
        setPendingRequest(pr);
      }
    } else {
      setMembership(null);
      setAllMemberships([]);
      setPendingRequest(null);
      clearCurrentFactory();
    }
  }

  async function switchFactory(factoryId: string) {
    const m = allMemberships.find((x) => x.factoryId === factoryId);
    if (!m) return;
    setMembership(m);
    setCurrentFactory(factoryId);
    await AsyncStorage.setItem(ACTIVE_FACTORY_KEY, factoryId);
  }

  async function refreshMembership() {
    if (!user) return;
    const all = await loadAllMemberships(user.id);
    setAllMemberships(all);
    if (all.length > 0) {
      const savedId = await AsyncStorage.getItem(ACTIVE_FACTORY_KEY);
      const active = all.find((m) => m.factoryId === savedId) ?? all[0];
      setMembership(active);
      setCurrentFactory(active.factoryId);
      setPendingRequest(null);
    } else {
      setMembership(null);
      clearCurrentFactory();
      const pr = await loadPendingRequest(user.id);
      setPendingRequest(pr);
    }
  }

  useEffect(() => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setLoading(false); } };
    const timer = setTimeout(finish, 8000);

    supabase.auth.getSession()
      .then(async ({ data: { session: s } }) => { await applySession(s); })
      .catch(() => {})
      .finally(() => { clearTimeout(timer); finish(); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      await applySession(s);
    });

    return () => { settled = true; clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  // ─── AUTH ─────────────────────────────────────────────────────

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle() {
    const redirectUrl = makeRedirectUri({ scheme: 'corning', path: 'auth-callback' });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    if (!data.url) return { error: 'Impossible de lancer Google.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
    if (result.type === 'success') {
      const url = new URL(result.url);
      const params = new URLSearchParams(url.hash.replace('#', ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
        if (sessionError) return { error: sessionError.message };
      }
    }
    return { error: null };
  }

  async function signOut() {
    clearCurrentFactory();
    setMembership(null);
    setPendingRequest(null);
    await supabase.auth.signOut();
  }

  // ─── FACTORY ──────────────────────────────────────────────────

  async function createFactory(name: string) {
    const { error } = await supabase.from('factories').insert({ name });
    if (error) return { error: error.message };
    await refreshMembership();
    return { error: null };
  }

  async function regenerateInviteCode() {
    if (!membership) return { error: 'Non connecté.' };
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const newCode = Array.from(bytes, b => chars[b % chars.length]).join('');
    const { error } = await supabase
      .from('factories')
      .update({ invite_code: newCode })
      .eq('id', membership.factoryId);
    if (error) return { error: error.message };
    return { error: null };
  }

  async function getInviteCode(): Promise<string | null> {
    if (!membership) return null;
    const { data } = await supabase.rpc('get_my_invite_code', { fid: membership.factoryId });
    return data ?? null;
  }

  async function requestToJoin(inviteCode: string) {
    if (!user) return { error: 'Non connecté.' };

    const { data: factories, error: lookupError } = await supabase
      .rpc('lookup_factory_by_code', { code: inviteCode.trim().toUpperCase() });

    if (lookupError || !factories?.length) {
      return { error: 'Code invalide. Vérifiez et réessayez.' };
    }
    const factory = factories[0];

    const { error } = await supabase.from('join_requests').insert({
      factory_id: factory.id,
      user_id: user.id,
      user_email: user.email ?? '',
    });

    if (error) {
      if (error.code === '23505') return { error: 'Vous avez déjà une demande en cours pour cette usine.' };
      return { error: error.message };
    }

    const pr = await loadPendingRequest(user.id);
    setPendingRequest(pr);
    return { error: null };
  }

  async function cancelJoinRequest() {
    if (!user || !pendingRequest) return { error: 'Aucune demande en cours.' };
    const { error } = await supabase
      .from('join_requests')
      .delete()
      .eq('id', pendingRequest.id)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    setPendingRequest(null);
    return { error: null };
  }

  // ─── ADMIN ────────────────────────────────────────────────────

  async function getMembers(): Promise<MemberDisplay[]> {
    if (!membership) return [];
    const { data: members, error } = await supabase
      .from('factory_members')
      .select('id, user_id, role')
      .eq('factory_id', membership.factoryId);
    if (error || !members) return [];

    const userIds = members.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', userIds);

    const profileMap: Record<string, { email: string; displayName: string }> = {};
    profiles?.forEach(p => {
      profileMap[p.id] = {
        email: p.email ?? '',
        displayName: (p as any).display_name ?? '',
      };
    });

    return members.map((m) => ({
      memberId: m.id,
      userId: m.user_id,
      displayName: profileMap[m.user_id]?.displayName ?? '',
      email: profileMap[m.user_id]?.email
        || (m.user_id === user?.id ? (user?.email ?? '') : m.user_id.slice(0, 8) + '…'),
      role: m.role as UserRole,
      isCurrentUser: m.user_id === user?.id,
    }));
  }

  async function updateMemberRole(userId: string, role: UserRole) {
    if (!membership) return { error: 'Non connecté.' };
    const { error } = await supabase.from('factory_members')
      .update({ role })
      .eq('factory_id', membership.factoryId)
      .eq('user_id', userId);
    return { error: error?.message ?? null };
  }

  async function removeMember(userId: string) {
    if (!membership) return { error: 'Non connecté.' };
    const { error } = await supabase.from('factory_members')
      .delete()
      .eq('factory_id', membership.factoryId)
      .eq('user_id', userId);
    return { error: error?.message ?? null };
  }

  async function getPendingRequests(): Promise<JoinRequestDisplay[]> {
    if (!membership) return [];
    const { data, error } = await supabase
      .from('join_requests')
      .select('id, user_id, user_email, created_at')
      .eq('factory_id', membership.factoryId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(r => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      createdAt: r.created_at,
    }));
  }

  async function approveJoinRequest(requestId: string, _userId: string, role: UserRole) {
    if (!membership) return { error: 'Non connecté.' };
    const { error } = await supabase.rpc('approve_join_request', {
      req_id: requestId,
      target_role: role,
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function rejectJoinRequest(requestId: string) {
    if (!membership) return { error: 'Non connecté.' };
    const { error } = await supabase
      .from('join_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId);
    return { error: error?.message ?? null };
  }

  return (
    <AuthContext.Provider value={{
      session, user, membership, allMemberships, pendingRequest, loading,
      switchFactory,
      signUp, signIn, signInWithGoogle, signOut,
      createFactory, regenerateInviteCode, getInviteCode, requestToJoin, cancelJoinRequest, refreshMembership,
      getMembers, updateMemberRole, removeMember,
      getPendingRequests, approveJoinRequest, rejectJoinRequest,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
