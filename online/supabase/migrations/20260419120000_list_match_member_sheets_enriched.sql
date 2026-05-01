-- Enriquece list_match_member_sheets_for_master: retrato, concepto y estado de conexión para la vista tipo «tirada» del master web.
-- Postgres no permite cambiar el tipo de retorno (OUT) con CREATE OR REPLACE: hay que borrar y volver a crear.

drop function if exists public.list_match_member_sheets_for_master(uuid);

create function public.list_match_member_sheets_for_master(p_match_id uuid)
returns table (
  member_user_id uuid,
  member_role public.match_member_role,
  character_id uuid,
  character_name text,
  owner_display text,
  avatar_url text,
  concept text,
  connection_status public.connection_status,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mm.user_id as member_user_id,
    mm.role as member_role,
    c.id as character_id,
    c.name as character_name,
    coalesce(nullif(trim(both from pr.display_name), ''), pr.username, '')::text as owner_display,
    c.avatar_url::text as avatar_url,
    c.concept::text as concept,
    mm.connection_status,
    mm.last_seen_at
  from public.match_members mm
  join public.matches m on m.id = mm.match_id and m.master_user_id = auth.uid()
  join public.profiles pr on pr.id = mm.user_id
  left join public.characters c on c.id = mm.active_character_id and c.is_archived = false
  where mm.match_id = p_match_id
  order by
    case when mm.role = 'master'::public.match_member_role then 0 else 1 end,
    pr.username;
$$;

comment on function public.list_match_member_sheets_for_master(uuid) is
  'Solo el master: miembros con usuario, rol, personaje elegido (si hay), avatar_url, concept, connection_status.';

revoke all on function public.list_match_member_sheets_for_master(uuid) from public;
grant execute on function public.list_match_member_sheets_for_master(uuid) to authenticated;
