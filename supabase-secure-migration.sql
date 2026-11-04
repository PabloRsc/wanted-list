-- Wanted List 1.9 — bloquear acesso direto do navegador à tabela completa.
-- Execute no SQL Editor do Supabase SOMENTE DEPOIS de publicar e testar a Edge Function.
-- Os dados existentes permanecem na tabela; nenhuma linha é apagada.

alter table public.wanted_list_state enable row level security;
revoke all on table public.wanted_list_state from anon, authenticated;
grant all on table public.wanted_list_state to service_role;

drop policy if exists "Public can read Wanted List" on public.wanted_list_state;
drop policy if exists "Public can create Wanted List state" on public.wanted_list_state;
drop policy if exists "Public can update Wanted List state" on public.wanted_list_state;
drop policy if exists "Public can delete Wanted List state" on public.wanted_list_state;

-- A tabela continua com os dados atuais. Somente a Edge Function, usando
-- SUPABASE_SERVICE_ROLE_KEY armazenada como secret no servidor, poderá acessá-la.

create table if not exists public.wanted_list_pin_attempts (
  id bigint generated always as identity primary key,
  ip_key text not null,
  created_at timestamptz not null default now()
);
alter table public.wanted_list_pin_attempts enable row level security;
revoke all on table public.wanted_list_pin_attempts from anon, authenticated;
grant all on table public.wanted_list_pin_attempts to service_role;
create index if not exists wanted_list_pin_attempts_ip_created_idx on public.wanted_list_pin_attempts (ip_key, created_at);
