-- Permitir invitar el mismo email del master (misma cuenta en otro dispositivo).
-- Antes se bloqueaba con `cannot_invite_master_self`.

create or replace function public.invite_player_to_match_by_email(
  p_match_id uuid,
  p_email text,
  p_character_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  invitee uuid;
  m public.matches%rowtype;
  existing_id uuid;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if m.master_user_id <> uid then
    raise exception 'not_match_master';
  end if;

  select au.id into invitee
  from auth.users au
  where lower(trim(au.email)) = lower(trim(coalesce(p_email, '')))
  limit 1;

  if invitee is null then
    raise exception 'user_email_not_found';
  end if;

  if p_character_id is not null then
    if not exists (
      select 1 from public.characters c
      where c.id = p_character_id
        and c.owner_user_id = invitee
        and c.is_archived = false
    ) then
      raise exception 'character_not_owned_by_invitee';
    end if;
  end if;

  select i.id into existing_id
  from public.match_invites i
  where i.match_id = p_match_id
    and i.invited_user_id = invitee
    and i.status = 'pending'::public.match_invite_status
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.match_invites (
    match_id,
    invited_user_id,
    invited_character_id,
    invited_by_master_id,
    status
  ) values (
    p_match_id,
    invitee,
    p_character_id,
    uid,
    'pending'::public.match_invite_status
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.invite_player_to_match_by_email(uuid, text, uuid) is
  'Master de la partida: invita por email de auth.users. Permite invitar la misma cuenta del master para pruebas en otro dispositivo.';

revoke all on function public.invite_player_to_match_by_email(uuid, text, uuid) from public;
grant execute on function public.invite_player_to_match_by_email(uuid, text, uuid) to authenticated;
