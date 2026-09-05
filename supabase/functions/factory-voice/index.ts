import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Speech-to-text for Orny AI's voice mode. Transcribes via Groq's Whisper
// endpoint (whisper-large-v3) — strong on French/Portuguese/Spanish/English,
// the four languages this feature actually needs (unlike Guinea's local
// languages — Susu, Malinké, Pular — which Whisper handles poorly; that gap
// doesn't apply here). The Groq key stays server-side, same posture as
// supabase/functions/factory-chat — the client never talks to Groq directly.

const WHISPER_MODEL = 'whisper-large-v3'
const MAX_AUDIO_BYTES = 15 * 1024 * 1024 // 15MB — generous for a spoken question

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  if (!jwt) return json({ error: 'Non authentifié.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return json({ error: "Orny AI n'est pas encore configuré (clé Groq manquante)." }, 500)

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: userError } = await callerClient.auth.getUser()
  if (userError || !user) return json({ error: 'Session invalide.' }, 401)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Requête invalide.' }, 400)
  }

  const factoryId = form.get('factory_id')
  const audio = form.get('audio')
  if (typeof factoryId !== 'string' || !factoryId) return json({ error: 'factory_id manquant.' }, 400)
  if (!(audio instanceof File)) return json({ error: 'Fichier audio manquant.' }, 400)
  if (audio.size > MAX_AUDIO_BYTES) return json({ error: 'Enregistrement trop long.' }, 400)

  const { data: membership } = await callerClient
    .from('factory_members')
    .select('role')
    .eq('factory_id', factoryId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return json({ error: "Vous n'êtes pas membre de cette usine." }, 403)

  // Groq's transcription endpoint takes the same multipart shape OpenAI's
  // Whisper API does — re-wrap rather than forward the original request body,
  // since we still need to attach model/response_format alongside the file.
  const groqForm = new FormData()
  groqForm.append('file', audio, audio.name || 'audio.m4a')
  groqForm.append('model', WHISPER_MODEL)
  groqForm.append('response_format', 'verbose_json')

  const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}` },
    body: groqForm,
  })

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '')
    console.error('Groq transcription failed', groqRes.status, errText)
    return json({ error: 'Transcription indisponible. Réessayez.' }, 502)
  }

  const data = await groqRes.json()
  const text = (data?.text ?? '').trim()
  if (!text) return json({ error: "Rien n'a été compris. Réessayez.", text: '' }, 200)

  // Whisper's detected language is a plain ISO-639-1-ish code (e.g. "french",
  // "portuguese") — passed through as-is; the client only uses it to decide
  // a TTS voice locale, so exact normalization isn't load-bearing here.
  return json({ text, language: data?.language ?? null }, 200)
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
