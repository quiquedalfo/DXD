-- Lista personajes de jugadores que ya están en la partida (para asignar sin copiar UUID a mano).

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
    coalesce(nullif(trim(both from p.display_name), ''), p.username, '')::text as owner_display
  from public.characters c
  join public.profiles p on p.id = c.owner_user_id
  where c.is_archived = false
    and exists (
      select 1
      from public.matches m
      where m.id = p_match_id
        and m.master_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.match_members mm
      where mm.match_id = p_match_id
        and mm.user_id = c.owner_user_id
        and mm.role = 'player'::public.match_member_role
    );
$$;

comment on function public.list_player_characters_for_master(uuid) is
  'Solo el master de la partida: personajes (no archivados) cuyo dueño es miembro jugador de esa partida.';

revoke all on function public.list_player_characters_for_master(uuid) from public;
grant execute on function public.list_player_characters_for_master(uuid) to authenticated;
