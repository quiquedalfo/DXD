-- Latido de presencia: el miembro autenticado marca online + last_seen_at (la web del director lo usa para estado).

create or replace function public.ping_match_presence(p_match_id uuid)
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

  update public.match_members mm
  set
    connection_status = 'online'::public.connection_status,
    last_seen_at = now()
  where mm.match_id = p_match_id
    and mm.user_id = uid;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'not_a_member_in_match';
  end if;
end;
$$;

comment on function public.ping_match_presence(uuid) is
  'Miembro de la partida: marca connection_status=online y last_seen_at=now() para auth.uid() en esa partida.';

grant execute on function public.ping_match_presence(uuid) to authenticated;
