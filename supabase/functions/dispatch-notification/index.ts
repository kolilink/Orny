import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Sends a real, server-triggered push notification via Expo's push API.
// Recipients are ALWAYS resolved server-side from real factory_members rows
// — a caller-supplied target_user_ids list only ever narrows an already-
// resolved recipient set, it can never add someone who isn't a real member.
// This function IS the trust boundary; it deliberately uses the service-role
// key to read factory_members/push_tokens regardless of RLS.

interface DispatchBody {
  factory_id: string
  title: string
  body: string
  target_roles?: string[]      // e.g. ['admin', 'employee'] — omit for everyone in the factory
  target_user_ids?: string[]   // optional extra narrowing, intersected against real members
  data?: Record<string, unknown>
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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // JWT-scoped client — used only to confirm who the caller really is.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: userError } = await callerClient.auth.getUser()
  if (userError || !user) return json({ error: 'Session invalide.' }, 401)

  let payload: DispatchBody
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Payload invalide.' }, 400)
  }
  if (!payload.factory_id || !payload.title || !payload.body) {
    return json({ error: 'Champs manquants.' }, 400)
  }

  // Service-role client — deliberately bypasses RLS to resolve real
  // membership and tokens; this function is the boundary that makes that safe.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerMembership } = await admin
    .from('factory_members')
    .select('role')
    .eq('factory_id', payload.factory_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!callerMembership) {
    return json({ error: "Vous n'êtes pas membre de cette usine." }, 403)
  }

  let membersQuery = admin
    .from('factory_members')
    .select('user_id, role')
    .eq('factory_id', payload.factory_id)

  if (payload.target_roles?.length) {
    membersQuery = membersQuery.in('role', payload.target_roles)
  }

  const { data: members } = await membersQuery
  let recipientIds = (members ?? []).map((m) => m.user_id as string)

  if (payload.target_user_ids?.length) {
    const allowed = new Set(payload.target_user_ids)
    recipientIds = recipientIds.filter((id) => allowed.has(id))
  }

  if (recipientIds.length === 0) return json({ sent: 0 }, 200)

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .in('user_id', recipientIds)

  const messages = (tokens ?? [])
    .filter((t) => t.expo_push_token)
    .map((t) => ({
      to: t.expo_push_token as string,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      // 'notification.wav' matches the sound name expo-notifications bundles
      // via app.json's plugin config on iOS; channelId routes Android to the
      // channel created in utils/notifications.ts that was set up with that
      // same sound — Android ignores a per-message sound field once a
      // channel exists, so channelId is what actually selects it there.
      sound: 'notification.wav',
      channelId: 'orny-default',
    }))

  if (messages.length === 0) return json({ sent: 0 }, 200)

  const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  })

  if (!expoRes.ok) {
    const errText = await expoRes.text().catch(() => '')
    console.error('Expo push send failed', expoRes.status, errText)
    return json({ error: 'Échec envoi push.' }, 502)
  }

  return json({ sent: messages.length }, 200)
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
