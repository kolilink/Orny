const SUPABASE_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Email ou mot de passe incorrect.',
  'Email not confirmed': 'Confirmez votre email avant de vous connecter.',
  'User already registered': 'Un compte existe déjà avec cet email.',
  'Password should be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
  'Unable to validate email address: invalid format': 'Adresse email invalide.',
  'Signup requires a valid password': 'Mot de passe invalide.',
  'Email rate limit exceeded': 'Trop de tentatives. Réessayez dans quelques minutes.',
  'over_email_send_rate_limit': 'Trop de tentatives. Réessayez plus tard.',
  'For security purposes, you can only request this after': 'Trop de tentatives. Attendez quelques secondes.',
  'invalid claim: missing sub claim': 'Session expirée. Reconnectez-vous.',
  'JWT expired': 'Session expirée. Reconnectez-vous.',
  'refresh_token_not_found': 'Session expirée. Reconnectez-vous.',
  'network request failed': 'Connexion internet indisponible.',
  'Network request failed': 'Connexion internet indisponible.',
  'fetch is not defined': 'Connexion internet indisponible.',
  'database error saving new user': 'Erreur lors de la création du compte. Contactez le support.',
};

export function toFrench(error: string): string {
  for (const [key, fr] of Object.entries(SUPABASE_ERRORS)) {
    if (error.toLowerCase().includes(key.toLowerCase())) return fr;
  }
  return error;
}
