-- Wanted List — hardening do rate limit dos baús privados
-- Aplicar somente depois de revisar e publicar a Edge Function compatível.
-- Não altera nem remove os dados de wanted_list_state.

create table if not exists public.wanted_list_pin_attempts (
  id bigint generated always as identity primary key,
  ip_key text not null,
  created_at timestamptz not null default now()
);

alter table public.wanted_list_pin_attempts enable row level security;
revoke all on table public.wanted_list_pin_attempts from anon, authenticated;
grant all on table public.wanted_list_pin_attempts to service_role;

create index if not exists wanted_list_pin_attempts_ip_created_idx
  on public.wanted_list_pin_attempts (ip_key, created_at);
create index if not exists wanted_list_pin_attempts_created_idx
  on public.wanted_list_pin_attempts (created_at);

-- Serializa tentativas do mesmo identificador para evitar que requisições
-- simultâneas ultrapassem o limite por uma corrida entre SELECT e INSERT.
create or replace function public.wanted_list_register_pin_attempt(p_ip_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_ip_key is null or length(p_ip_key) < 1 or length(p_ip_key) > 128 then
    raise exception 'invalid rate limit key';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_ip_key, 0)
  );

  -- Expira registros antigos globalmente para limitar o crescimento da tabela.
  delete from public.wanted_list_pin_attempts
   where created_at < pg_catalog.now() - interval '15 minutes';

  select count(*)::integer
    into v_attempts
    from public.wanted_list_pin_attempts
   where ip_key = p_ip_key
     and created_at >= pg_catalog.now() - interval '15 minutes';

  if v_attempts >= 8 then
    return false;
  end if;

  insert into public.wanted_list_pin_attempts (ip_key)
  values (p_ip_key);

  return true;
end;
$$;

-- A Edge Function usa service_role. Clientes anon/authenticated não podem
-- chamar a RPC diretamente.
revoke all on function public.wanted_list_register_pin_attempt(text)
  from public, anon, authenticated;
grant execute on function public.wanted_list_register_pin_attempt(text)
  to service_role;

create or replace function public.wanted_list_clear_pin_attempts(p_ip_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_key is null or length(p_ip_key) < 1 or length(p_ip_key) > 128 then
    raise exception 'invalid rate limit key';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_ip_key, 0)
  );

  delete from public.wanted_list_pin_attempts
   where ip_key = p_ip_key;
end;
$$;

revoke all on function public.wanted_list_clear_pin_attempts(text)
  from public, anon, authenticated;
grant execute on function public.wanted_list_clear_pin_attempts(text)
  to service_role;
