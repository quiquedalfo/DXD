-- Permite unirse con el código corto (matches.code) o con el UUID de la partida (matches.id).
--
-- SOLO ESTE ARCHIVO en SQL Editor: no incluye tablas ni policies. Si ves error en "profiles",
-- pegaste otro SQL (p. ej. initial_schema) o quedó texto arriba en el editor. Borrá todo y
-- volvé a pegar desde "create or replace function" hasta el final.

create or replace function public.join_match_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches%rowtype;
  uid uuid := auth.uid();
  v_in text := trim(coalesce(p_code, ''));
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if length(v_in) = 0 then
    raise exception 'empty_code';
  end if;

  if v_in ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into m
    from public.matches
    where id = v_in::uuid
    limit 1;
  else
    select * into m
    from public.matches
    where upper(code) = upper(v_in)
    limit 1;
  end if;

  if not found then
    raise exception 'invalid_code';
  end if;

  if m.status not in (
    'draft'::public.match_status,
    'live'::public.match_status,
    'paused'::public.match_status
  ) then
    raise exception 'match_not_joinable';
  end if;

  if uid = m.master_user_id then
    insert into public.match_members (match_id, user_id, role)
    values (m.id, uid, 'master'::public.match_member_role)
    on conflict (match_id, user_id) do nothing;
  else
    insert into public.match_members (match_id, user_id, role)
    values (m.id, uid, 'player'::public.match_member_role)
    on conflict (match_id, user_id) do nothing;
  end if;

  return m.id;
end;
$$;

comment on function public.join_match_with_code(text) is
  'Une auth.uid() a una partida por código corto (matches.code) o por UUID de partida (matches.id). Idempotente.';
