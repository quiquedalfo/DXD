-- Invitaciones del master a un jugador (por email). El jugador acepta o declina desde la app.

do $$ begin
  create type public.match_invite_status as enum ('pending', 'accepted', 'declined', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.match_invites (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  invited_user_id uuid not null references public.profiles (id) on delete cascade,
  invited_character_id uuid references public.characters (id) on delete set null,
  invited_by_master_id uuid not null references public.profiles (id) on delete restrict,
  status public.match_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists match_invites_one_pending_per_match_user
  on public.match_invites (match_id, invited_user_id)
  where status = 'pending'::public.match_invite_status;

alter table public.match_invites enable row level security;

create policy "match_invites_select_invitee"
on public.match_invites for select
using (invited_user_id = auth.uid());

create policy "match_invites_select_master"
on public.match_invites for select
using (
  exists (
    select 1 from public.matches x
    where x.id = match_invites.match_id
      and x.master_user_id = auth.uid()
  )
);

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

  if invitee = m.master_user_id then
    raise exception 'cannot_invite_master_self';
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

create or replace function public.respond_match_invite(p_invite_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    insert into public.match_members (match_id, user_id, role)
    values (inv.match_id, uid, 'player'::public.match_member_role)
    on conflict (match_id, user_id) do nothing;

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
$$;

comment on function public.invite_player_to_match_by_email(uuid, text, uuid) is
  'Master de la partida: invita por email de auth.users. Opcional personaje (debe ser del invitado).';

comment on function public.respond_match_invite(uuid, boolean) is
  'Invitado: acepta (une a la partida como player) o declina.';

revoke all on function public.invite_player_to_match_by_email(uuid, text, uuid) from public;
revoke all on function public.respond_match_invite(uuid, boolean) from public;

grant execute on function public.invite_player_to_match_by_email(uuid, text, uuid) to authenticated;
grant execute on function public.respond_match_invite(uuid, boolean) to authenticated;
