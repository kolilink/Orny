import * as Speech from 'expo-speech';

export type LanguageCode = 'fr' | 'pt' | 'es' | 'en';

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  fr: 'Français',
  pt: 'Português',
  es: 'Español',
  en: 'English',
};

const CODE_TO_LOCALE: Record<LanguageCode, string> = {
  fr: 'fr-FR',
  pt: 'pt-PT',
  es: 'es-ES',
  en: 'en-US',
};

// Groq/Whisper's verbose_json response returns the detected language as a
// full lowercase English name (e.g. "french", "portuguese"), not an ISO code.
const WHISPER_NAME_TO_LOCALE: Record<string, string> = {
  french: 'fr-FR',
  portuguese: 'pt-PT',
  spanish: 'es-ES',
  english: 'en-US',
};

// Whichever language should drive Orny AI's spoken reply: a per-user manual
// override (profiles.preferred_language, set in Profile settings) always
// wins when present; otherwise fall back to what Whisper actually detected
// in this specific recording, so a shared device can still get per-message
// language switching without every user having to set a preference first.
export function resolveLocale(detectedLanguage: string | null, preferredLanguage: LanguageCode | null): string {
  if (preferredLanguage) return CODE_TO_LOCALE[preferredLanguage];
  if (detectedLanguage) {
    const normalized = detectedLanguage.trim().toLowerCase();
    if (WHISPER_NAME_TO_LOCALE[normalized]) return WHISPER_NAME_TO_LOCALE[normalized];
  }
  return CODE_TO_LOCALE.fr;
}

// Always stop() first — an unfinished previous utterance would otherwise
// keep talking over a new reply once the user asks a follow-up question.
export function speak(text: string, locale: string): void {
  Speech.stop();
  Speech.speak(text, { language: locale });
}

export function stopSpeaking(): void {
  Speech.stop();
}
