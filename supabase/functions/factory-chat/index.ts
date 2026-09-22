import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Server-side home for Claude's model calls — the Groq API key never
// reaches the client, and the client never talks to Groq directly.
//
// The business snapshot itself is still built client-side from the app's
// existing offline-first stores (utils/businessData.ts / utils/coachPrompt.ts)
// — Orny has no SECURITY DEFINER RPC layer yet for a safe server-side
// re-fetch of a specific business's data, so for v1 the client sends the
// already-rendered system prompt + data context, and this function's only
// job is the privileged part: spending the shared Groq key, after confirming
// the caller is a real member of the factory they claim to be asking about.

// llama-3.3-70b-versatile was retired from Groq's catalog (confirmed via a
// direct call: 404 model_not_found, even though the API key itself is
// valid — GET /openai/v1/models no longer lists any meta-llama chat model
// at all). openai/gpt-oss-120b is Groq's current closest-tier open-weight
// replacement. It's a reasoning model — unlike Llama 3.3, part of its
// output is a separate internal "reasoning" field that consumes completion
// tokens before the real answer starts, so MAX_TOKENS is raised (1024 was
// tuned for a non-reasoning model and left too little headroom for a
// longer analysis reply to finish after the reasoning phase).
const GROQ_MODEL = 'openai/gpt-oss-120b'
const MAX_TOKENS = 2048
// The client (screens/Coach/index.tsx) already trims what it resends to
// the last ~30 messages before ever calling this function — this is a
// backstop against a single runaway session, not the real limit. Kept
// comfortably above that client-side window so a normal long conversation
// never actually hits it.
const MAX_MESSAGES = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatBody {
  factory_id: string
  system_prompt: string
  messages: ChatMessage[]
}

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

  if (!groqKey) {
    return json({ error: "Claude n'est pas encore configuré (clé Groq manquante)." }, 500)
  }

  // JWT-scoped client — every query below runs under the caller's own RLS,
  // so "am I a member of this factory" is answered by Postgres itself
  // (factory_members' "members can read their factory's members" policy),
  // not by anything this function has to trust from the request body.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: userError } = await callerClient.auth.getUser()
  if (userError || !user) return json({ error: 'Session invalide.' }, 401)

  let payload: ChatBody
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Payload invalide.' }, 400)
  }
  if (!payload.factory_id || !payload.system_prompt || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json({ error: 'Champs manquants.' }, 400)
  }
  if (payload.messages.length > MAX_MESSAGES) {
    return json({ error: 'Conversation trop longue — démarrez une nouvelle conversation.' }, 400)
  }

  const { data: membership } = await callerClient
    .from('factory_members')
    .select('role')
    .eq('factory_id', payload.factory_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return json({ error: "Vous n'êtes pas membre de cette usine." }, 403)
  }

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'system', content: payload.system_prompt }, ...payload.messages],
    }),
  })

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '')
    console.error('Groq call failed', groqRes.status, errText)
    return json({ error: 'Claude est momentanément indisponible. Réessayez dans un instant.' }, 502)
  }

  const data = await groqRes.json()
  const reply = data?.choices?.[0]?.message?.content
  if (!reply) return json({ error: 'Réponse vide.' }, 502)

  return json({ reply }, 200)
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
