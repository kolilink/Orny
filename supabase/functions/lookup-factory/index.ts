import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RATE_LIMIT = 5   // max attempts per window
const WINDOW_SEC = 60  // 1-minute rolling window

Deno.serve(async (req) => {
  // Allow CORS for the web PWA
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'

  let code: string
  try {
    const body = await req.json()
    code = String(body.code ?? '').trim().toUpperCase()
  } catch {
    return json({ factory: null }, 400)
  }

  if (!code || code.length !== 8) {
    return json({ factory: null }, 200)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Check rate limit
  const windowStart = new Date(Date.now() - WINDOW_SEC * 1000).toISOString()
  const { count } = await supabase
    .from('invite_lookup_log')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', windowStart)

  if ((count ?? 0) >= RATE_LIMIT) {
    return json({ error: 'Trop de tentatives. Attendez 1 minute.' }, 429)
  }

  // Log this attempt
  await supabase.from('invite_lookup_log').insert({ ip, code_tried: code })

  // Lookup
  const { data, error } = await supabase.rpc('lookup_factory_by_code', { code })
  if (error || !data?.length) {
    return json({ factory: null }, 200)
  }

  return json({ factory: data[0] }, 200)
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
