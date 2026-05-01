-- El master puede expulsar a un jugador de la partida (quita fila en match_members y datos de mesa asociados).
-- No permite expulsar al creador de la partida (matches.master_user_id).

create or replace function public.kick_member_from_match(
  p_match_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  muid uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select m.master_user_id into muid
  from public.matches m
  where m.id = p_match_id;

  if muid is null then
    raise exception 'match_not_found';
  end if;

  if muid <> uid then
    raise exception 'not_match_master';
  end if;

  if p_user_id = muid then
    raise exception 'cannot_kick_match_master';
  end if;

  delete from public.character_runtime cr
  where cr.match_id = p_match_id
    and cr.character_id in (
      select mc.character_id
      from public.match_characters mc
      where mc.match_id = p_match_id
        and mc.user_id = p_user_id
    );

  delete from public.match_characters mc
  where mc.match_id = p_match_id
    and mc.user_id = p_user_id;

  delete from public.match_members mm
  where mm.match_id = p_match_id
    and mm.user_id = p_user_id;
end;
$$;

comment on function public.kick_member_from_match(uuid, uuid) is
  'Solo el master de la partida: expulsa a un usuario (no al creador). Limpia runtime y match_characters de esa mesa.';

revoke all on function public.kick_member_from_match(uuid, uuid) from public;
grant execute on function public.kick_member_from_match(uuid, uuid) to authenticated;
