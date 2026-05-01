-- Hoja elegida por jugador por partida: el master solo ve esa en list_player_characters_for_master.

alter table public.match_members
  add column if not exists active_character_id uuid references public.characters (id) on delete set null;

comment on column public.match_members.active_character_id is
  'Personaje que el jugador eligió para esta partida (app móvil). El master lista solo estos.';

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
      and mm.role = 'player'::public.match_member_role
  ) then
    raise exception 'not_a_player_in_match';
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
  set active_character_id = p_character_id
  where mm.match_id = p_match_id
    and mm.user_id = uid
    and mm.role = 'player'::public.match_member_role;

  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'match_member_update_expected_one_row got %', n;
  end if;
end;
$$;

comment on function public.set_player_active_character_for_match(uuid, uuid) is
  'Jugador miembro: guarda qué personaje usa en esta partida (para el listado del master).';

revoke all on function public.set_player_active_character_for_match(uuid, uuid) from public;
grant execute on function public.set_player_active_character_for_match(uuid, uuid) to authenticated;

create or replace function public.list_player_characters_for_master(p_match_id uuid)
returns table (
  character_id uuid,
  owner_user_id uuid,
  character_name text,
  owner_display text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as character_id,
    c.owner_user_id,
    c.name as character_name,
    coalesce(nullif(trim(both from pr.display_name), ''), pr.username, '')::text as owner_display
  from public.characters c
  join public.profiles pr on pr.id = c.owner_user_id
  join public.matches m on m.id = p_match_id and m.master_user_id = auth.uid()
  join public.match_members mm
    on mm.match_id = p_match_id
   and mm.user_id = c.owner_user_id
   and mm.role = 'player'::public.match_member_role
   and mm.active_character_id = c.id
  where c.is_archived = false
    and mm.active_character_id is not null;
$$;

comment on function public.list_player_characters_for_master(uuid) is
  'Solo el master: personajes que cada jugador eligió para esta partida (match_members.active_character_id).';
