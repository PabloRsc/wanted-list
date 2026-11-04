-- Wanted List: estado único compartilhado, sem login.
-- ATENÇÃO: as políticas abaixo permitem que qualquer visitante com acesso ao app
-- leia, substitua ou exclua os dados. Use apenas se aceitar esse comportamento.
create table if not exists public.wanted_list_state (
  id integer primary key check (id = 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.wanted_list_state enable row level security;
grant select, insert, update, delete on public.wanted_list_state to anon;

drop policy if exists "Public can read Wanted List" on public.wanted_list_state;
create policy "Public can read Wanted List"
  on public.wanted_list_state for select to anon using (true);

drop policy if exists "Public can create Wanted List state" on public.wanted_list_state;
create policy "Public can create Wanted List state"
  on public.wanted_list_state for insert to anon with check (id = 1);

drop policy if exists "Public can update Wanted List state" on public.wanted_list_state;
create policy "Public can update Wanted List state"
  on public.wanted_list_state for update to anon using (id = 1) with check (id = 1);

drop policy if exists "Public can delete Wanted List state" on public.wanted_list_state;
create policy "Public can delete Wanted List state"
  on public.wanted_list_state for delete to anon using (id = 1);
