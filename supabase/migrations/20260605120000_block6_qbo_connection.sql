-- Block 6 Wave 6.2 — QBO connection credential storage.
--
-- `source_connections.encrypted_credentials` is bytea, holding an app-side
-- AES-256-GCM blob (encryption in `src/lib/qbo/crypto.ts`). PostgREST can't
-- round-trip bytea cleanly from supabase-js, so the service-role connection
-- path goes through these two helpers that bridge bytea <-> base64 in SQL.
--
-- Locked to service_role: the OAuth callback + sync factory run with the
-- service-role client (authorized at the action/route gate). Even though the
-- value is ciphertext an authenticated user can't decrypt (the key is a
-- server-only env var), there's no reason to expose it through PostgREST, so
-- execute is revoked from public/authenticated.

create or replace function public.set_qbo_credentials(p_connection uuid, p_b64 text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.source_connections
     set encrypted_credentials = decode(p_b64, 'base64')
   where id = p_connection;
$$;

create or replace function public.get_qbo_credentials(p_connection uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(encrypted_credentials, 'base64')
    from public.source_connections
   where id = p_connection;
$$;

revoke all on function public.set_qbo_credentials(uuid, text) from public;
revoke all on function public.get_qbo_credentials(uuid) from public;
grant execute on function public.set_qbo_credentials(uuid, text) to service_role;
grant execute on function public.get_qbo_credentials(uuid) to service_role;
