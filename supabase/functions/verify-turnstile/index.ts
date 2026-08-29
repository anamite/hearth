/**
 * Hearth — Turnstile verification (spec §18.1)
 *
 * The one thing that genuinely needs an Edge Function: an outbound HTTP call
 * to Cloudflare. Everything else is data manipulation and lives in Postgres.
 *
 * Takes a Turnstile token, verifies it with Cloudflare, and mints a
 * short-lived single-use nonce that create_group / join_group will accept.
 *
 * Deploy:  supabase functions deploy verify-turnstile
 * Secrets: supabase secrets set TURNSTILE_SECRET_KEY=...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return json({ error: 'not_configured' }, 500);

  let token = '';
  try {
    ({ token } = await req.json());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!token) return json({ error: 'missing_token' }, 400);

  // Cloudflare sees the caller's IP; we never store it (§18.2).
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);

  const verdict = await fetch(SITEVERIFY, { method: 'POST', body: form })
    .then((r) => r.json() as Promise<{ success: boolean }>)
    .catch(() => ({ success: false }));

  if (!verdict.success) return json({ error: 'failed_challenge' }, 403);

  const nonce = crypto.randomUUID();
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { error } = await admin.from('turnstile_nonces').insert({ nonce });
  if (error) return json({ error: 'could_not_issue' }, 500);

  return json({ nonce });
});
