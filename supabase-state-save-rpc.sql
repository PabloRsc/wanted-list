-- Wanted List — salvamento transacional do estado compartilhado
-- Aplicar junto com supabase-hardening-rpc.sql.
-- A função serializa gravações com SELECT ... FOR UPDATE e preserva baús privados
-- no caminho público. A Edge Function deve chamar esta RPC em vez de read/merge/write.

create or replace function public.wanted_list_save_state(p_incoming jsonb, p_allow_private boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
  v_private_ids text[];
  v_private_product_ids text[];
  v_result jsonb;
  v_lists jsonb;
  v_products jsonb;
  v_history jsonb;
begin
  if p_incoming is null
     or jsonb_typeof(p_incoming) <> 'object'
     or jsonb_typeof(p_incoming->'lists') <> 'array'
     or jsonb_typeof(p_incoming->'products') <> 'array'
     or (p_incoming ? 'history' and jsonb_typeof(p_incoming->'history') <> 'array') then
    raise exception 'invalid Wanted List payload';
  end if;

  if pg_catalog.pg_column_size(p_incoming) > 5000000 then
    raise exception 'Wanted List payload too large';
  end if;

  -- Lock da linha única. Se ainda não existir, o advisory lock serializa
  -- a criação concorrente do primeiro estado.
  perform pg_catalog.pg_advisory_xact_lock(741902311);
  select payload into v_current
    from public.wanted_list_state
   where id = 1
   for update;

  if p_allow_private or v_current is null then
    v_result := p_incoming;
  else
    select coalesce(array_agg(x->>'id'), array[]::text[])
      into v_private_ids
      from jsonb_array_elements(coalesce(v_current->'lists','[]'::jsonb)) x
     where x->>'isPrivate' = 'true';

    select coalesce(array_agg(x->>'id'), array[]::text[])
      into v_private_product_ids
      from jsonb_array_elements(coalesce(v_current->'products','[]'::jsonb)) x
     where exists (
       select 1
         from jsonb_array_elements_text(coalesce(x->'lists','[]'::jsonb)) linked(list_id)
        where linked.list_id = any(v_private_ids)
     );

    -- Se ainda não existem baús privados, mantém a compatibilidade com
    -- a criação inicial do primeiro baú privado pelo fluxo atual.
    if coalesce(array_length(v_private_ids,1),0) = 0 then
      v_result := p_incoming;
    else
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        into v_lists
        from (
          select x
            from jsonb_array_elements(coalesce(p_incoming->'lists','[]'::jsonb)) x
           where coalesce(x->>'isPrivate','false') <> 'true'
          union all
          select x
            from jsonb_array_elements(coalesce(v_current->'lists','[]'::jsonb)) x
           where x->>'isPrivate' = 'true'
        ) s(x);

      select coalesce(jsonb_agg(x), '[]'::jsonb)
        into v_products
        from (
          select x
            from jsonb_array_elements(coalesce(p_incoming->'products','[]'::jsonb)) x
           where not exists (
             select 1
               from jsonb_array_elements_text(coalesce(x->'lists','[]'::jsonb)) linked(list_id)
              where linked.list_id = any(v_private_ids)
           )
          union all
          select x
            from jsonb_array_elements(coalesce(v_current->'products','[]'::jsonb)) x
           where (x->>'id') = any(v_private_product_ids)
        ) s(x);

      select coalesce(jsonb_agg(x), '[]'::jsonb)
        into v_history
        from (
          select x
            from jsonb_array_elements(coalesce(p_incoming->'history','[]'::jsonb)) x
           where exists (
             select 1 from jsonb_array_elements(coalesce(v_products,'[]'::jsonb)) p
              where p->>'id' = x->>'productId'
           )
             and not ((x->>'productId') = any(v_private_product_ids))
          union all
          select x
            from jsonb_array_elements(coalesce(v_current->'history','[]'::jsonb)) x
           where (x->>'productId') = any(v_private_product_ids)
        ) s(x);

      v_result := jsonb_build_object(
        'schemaVersion', coalesce(p_incoming->'schemaVersion', v_current->'schemaVersion', '2'::jsonb),
        'lists', v_lists,
        'products', v_products,
        'history', v_history
      );
    end if;
  end if;

  insert into public.wanted_list_state (id, payload, updated_at)
  values (1, v_result, pg_catalog.now())
  on conflict (id) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_result;
end;
$$;

revoke all on function public.wanted_list_save_state(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.wanted_list_save_state(jsonb, boolean)
  to service_role;
