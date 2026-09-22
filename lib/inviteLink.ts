import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

// The web PWA's own production URL — this app has no separate marketing
// site, so the already-deployed PWA (Netlify) doubles as the universal
// "works even without the app installed" landing page for an invite link:
// opened in a mobile browser, it's the real, functioning app, with the
// invite code pre-filled straight into the Join tab (see
// screens/Auth/FactorySetupScreen.tsx). On web itself this constant is
// never used — window.location.origin is always correct there instead.
//
// Verified 2026-09-22 (curl: HTTP 200, <title>orny</title>) — this does match
// the real deployed site. Still not declared anywhere else in this codebase
// (no netlify.toml site name, no linked .netlify/state.json), so if the site
// is ever renamed or moved to a custom domain, this constant won't follow
// automatically — update it by hand at that point.
export const PRODUCTION_WEB_URL = 'https://orny.netlify.app';

function siteOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return PRODUCTION_WEB_URL;
}

export function buildInviteLink(code: string): string {
  return `${siteOrigin()}/join?code=${encodeURIComponent(code)}`;
}

// Pulls a `?code=` (or `code` path segment) out of any URL this app might
// be opened with — the web PWA's own address bar, or (once a real native
// build exists) a corning:// deep link. Deliberately tolerant of both
// query-string and bare-string input, since web's window.location.search
// and a parsed Linking URL don't hand this back in quite the same shape.
export function parseInviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code;
    if (typeof code === 'string' && code.trim()) return code.trim().toUpperCase();
  } catch {
    // Fall through to a plain regex — Linking.parse can throw on a bare
    // "?code=..." string with no scheme/host, which is exactly what
    // window.location.search hands us on web.
  }
  const match = url.match(/code=([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : null;
}

// Cold-start only — a link tapped while the app is already running arrives
// via Linking's 'url' event instead (subscribed once, in AuthContext, next
// to where this is used).
export async function getInitialInviteCode(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    return parseInviteCodeFromUrl(window.location.search);
  }
  const initialUrl = await Linking.getInitialURL();
  return parseInviteCodeFromUrl(initialUrl);
}
