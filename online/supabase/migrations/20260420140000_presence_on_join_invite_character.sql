-- Al unirse o elegir hoja: marcar online + last_seen (sin tocar respond_match_invite: requiere tabla match_invites; ver migración siguiente).

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
    insert into public.match_members (match_id, user_id, role, connection_status, last_seen_at)
    values (m.id, uid, 'master'::public.match_member_role, 'online'::public.connection_status, now())
    on conflict (match_id, user_id) do update set
      connection_status = 'online'::public.connection_status,
      last_seen_at = now();
  else
    insert into public.match_members (match_id, user_id, role, connection_status, last_seen_at)
    values (m.id, uid, 'player'::public.match_member_role, 'online'::public.connection_status, now())
    on conflict (match_id, user_id) do update set
      connection_status = 'online'::public.connection_status,
      last_seen_at = now();
  end if;

  return m.id;
end;
$$;

comment on function public.join_match_with_code(text) is
  'Une auth.uid() a una partida por código o UUID de partida. Idempotente; refresca presencia online + last_seen.';

create or replace function public.set_player_active_character_for_match(
  p_match_id uuid,
  p_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.match_members mm
    where mm.match_id = p_match_id
      and mm.user_id = uid
  ) then
    raise exception 'not_a_member_in_match';
  end if;

  if not exists (
    select 1 from public.characters c
    where c.id = p_character_id
      and c.owner_user_id = uid
      and c.is_archived = false
  ) then
    raise exception 'character_not_owned';
  end if;

  update public.match_members mm
  set
    active_character_id = p_character_id,
    connection_status = 'online'::public.connection_status,
    last_seen_at = now()
  where mm.match_id = p_match_id
    and mm.user_id = uid;

  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'match_member_update_expected_one_row got %', n;
  end if;
end;
$$;

comment on function public.set_player_active_character_for_match(uuid, uuid) is
  'Miembro (master o player): active_character_id + presencia online para la web del director.';
