-- Solo si ya existe `match_invites` (migración 20260415210000 u otra). Evita 42P01 en proyectos sin invitaciones.

do $migration$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'match_invites'
  ) then
    execute $func$
create or replace function public.respond_match_invite(p_invite_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $body$
declare
  uid uuid := auth.uid();
  inv public.match_invites%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into inv from public.match_invites where id = p_invite_id for update;
  if not found then
    raise exception 'invite_not_found';
  end if;
  if inv.invited_user_id <> uid then
    raise exception 'not_invitee';
  end if;
  if inv.status <> 'pending'::public.match_invite_status then
    raise exception 'invite_not_pending';
  end if;

  if p_accept then
    insert into public.match_members (match_id, user_id, role, connection_status, last_seen_at)
    values (inv.match_id, uid, 'player'::public.match_member_role, 'online'::public.connection_status, now())
    on conflict (match_id, user_id) do update set
      connection_status = 'online'::public.connection_status,
      last_seen_at = now();

    update public.match_invites
    set
      status = 'accepted'::public.match_invite_status,
      responded_at = now()
    where id = p_invite_id;
  else
    update public.match_invites
    set
      status = 'declined'::public.match_invite_status,
      responded_at = now()
    where id = p_invite_id;
  end if;
end;
$body$;
$func$;

    execute $cmt$
comment on function public.respond_match_invite(uuid, boolean) is
  'Invitado: acepta (une como player con presencia online) o declina.';
$cmt$;
  end if;
end;
$migration$;
