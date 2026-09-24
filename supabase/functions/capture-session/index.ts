// Supabase Edge Function: capture-session
//
// Captures the participant's IP address from the incoming server request
// (never from a client-submitted value), hashes it with a server-only salt,
// and upserts a session record keyed by participantId. Uses the service-role
// key, which lives only in this function's server-side environment - it is
// never sent to or readable by the browser.
//
// Deploy with the Supabase CLI (see README "Supabase setup" section):
//   supabase functions deploy capture-session
//   supabase secrets set IP_HASH_SALT=<a-long-random-value>

import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = '*';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const participantId = typeof body?.participantId === 'string' ? body.participantId.trim() : '';
  if (!participantId) {
    return json({ error: 'participantId is required' }, 400);
  }

  const salt = Deno.env.get('IP_HASH_SALT');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!salt || !supabaseUrl || !serviceRoleKey) {
    console.error('capture-session is missing required environment configuration.');
    return json({ error: 'Server misconfiguration' }, 500);
  }

  // req.headers reflects the platform-terminated connection, so this is the
  // real client IP as seen by the server, not anything the client can spoof.
  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  const clientIp = forwardedFor.split(',')[0].trim() || 'unknown';
  const userAgent = req.headers.get('user-agent') || '';
  const ipHash = await sha256Hex(`${clientIp}:${salt}`);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { error } = await supabase
    .from('participant_sessions')
    .upsert(
      {
        participantId,
        ipHash,
        userAgent,
        role: typeof body?.role === 'string' ? body.role : null,
        mode: typeof body?.mode === 'string' ? body.mode : null
      },
      { onConflict: 'participantId' }
    );

  if (error) {
    console.error('Could not store participant session:', error.message);
    return json({ error: 'Could not store session' }, 500);
  }

  return json({ ok: true });
});

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
