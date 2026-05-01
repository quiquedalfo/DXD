-- Al salir de la mesa o cerrar sesión, el cliente marca offline para que el director no vea «En mesa» con la app cerrada.

create or replace function public.leave_match_presence(p_match_id uuid)
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
    connection_status = 'offline'::public.connection_status,
    last_seen_at = now()
  where mm.match_id = p_match_id
    and mm.user_id = uid;

  get diagnostics n = row_count;
  if n = 0 then
    return;
  end if;
end;
$$;

comment on function public.leave_match_presence(uuid) is
  'Miembro autenticado: marca connection_status=offline en esa partida (salir de mesa / cerrar sesión). Idempotente si ya no hay fila.';

grant execute on function public.leave_match_presence(uuid) to authenticated;
