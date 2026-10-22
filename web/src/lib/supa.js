import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://pbpykslavelftkerhtib.supabase.co';
const ANON = 'sb_publishable_JTyM-NhHmWiaB5DdJaUd3w_LgBZYG-X';

export const sb = createClient(SUPABASE_URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'planner-auth' },
});

export async function fn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
