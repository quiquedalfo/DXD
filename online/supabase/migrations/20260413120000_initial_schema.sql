-- DXD Online — schema inicial (Postgres / Supabase)
-- Revisar diferencias con el desktop Python: explosión y orden visual de stats se resuelven en dominio TS.

-- Extensions
create extension if not exists "pgcrypto";

-- Enums
do $$ begin
  create type public.stat_key as enum (
    'brains', 'brawn', 'fight', 'flight', 'charm', 'grit'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.die_size as enum ('4', '6', '8', '10', '12', '20');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum (
    'draft', 'live', 'paused', 'finished', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_member_role as enum ('master', 'player');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connection_status as enum ('offline', 'online');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_target_scope as enum (
    'single_player', 'multiple_players', 'all_players'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_entity_status as enum (
    'open', 'answered', 'resolved', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_target_response_status as enum (
    'pending', 'submitted', 'approved', 'rejected', 'timeout'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.runtime_check_status as enum (
    'idle', 'waiting_response', 'responded', 'resolved', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.roll_outcome as enum ('pass', 'fail', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_response_outcome as enum ('pass', 'fail');
exception when duplicate_object then null; end $$;

-- Profiles (1:1 con auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  avatar_url text,
  concept text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_stats (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  stat_key public.stat_key not null,
  stat_label text not null,
  die_size public.die_size not null,
  base_modifier integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id, stat_key)
);

create table if not exists public.character_resources (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  starting_tokens integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  master_user_id uuid not null references public.profiles (id) on delete restrict,
  status public.match_status not null default 'draft',
  current_scene_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.match_members (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.match_member_role not null,
  joined_at timestamptz not null default now(),
  connection_status public.connection_status not null default 'offline',
  last_seen_at timestamptz,
  unique (match_id, user_id)
);

create table if not exists public.match_characters (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete restrict,
  is_active boolean not null default true,
  assigned_by_master_user_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (match_id, user_id, character_id)
);

create table if not exists public.character_runtime (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  current_tokens integer not null default 0,
  current_modifier integer not null default 0,
  current_check_value integer,
  current_check_stat_key public.stat_key,
  current_check_prompt text,
  check_status public.runtime_check_status not null default 'idle',
  last_roll_value integer,
  last_total_value integer,
  last_result public.roll_outcome not null default 'none',
  last_margin integer,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (match_id, character_id)
);

create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  target_scope public.check_target_scope not null,
  created_by_user_id uuid not null references public.profiles (id) on delete restrict,
  stat_key public.stat_key not null,
  stat_label_at_time text not null,
  check_value integer not null,
  prompt_text text,
  instructions_text text,
  allow_token_spend boolean not null default false,
  allow_manual_modifier boolean not null default false,
  status public.check_entity_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.check_targets (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  response_status public.check_target_response_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (check_id, user_id, character_id)
);

create table if not exists public.check_responses (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  stat_key public.stat_key not null,
  die_size_at_time public.die_size not null,
  roll_value integer not null,
  tokens_spent integer not null default 0,
  modifier_applied integer not null default 0,
  computed_total integer not null,
  target_value integer not null,
  outcome public.check_response_outcome not null,
  margin integer not null,
  explosion_flag boolean not null default false,
  submitted_at timestamptz not null default now(),
  reviewed_by_master boolean not null default false,
  reviewed_at timestamptz
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_events_match_created
  on public.match_events (match_id, created_at desc);

create index if not exists idx_checks_match_status
  on public.checks (match_id, status);

create index if not exists idx_check_targets_user_pending
  on public.check_targets (user_id, response_status);

-- updated_at triggers (simple)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_characters_updated on public.characters;
create trigger trg_characters_updated
before update on public.characters
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_character_stats_updated on public.character_stats;
create trigger trg_character_stats_updated
before update on public.character_stats
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_character_resources_updated on public.character_resources;
create trigger trg_character_resources_updated
before update on public.character_resources
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_matches_updated on public.matches;
create trigger trg_matches_updated
before update on public.matches
for each row execute procedure public.set_updated_at();

-- Profile bootstrap on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.character_stats enable row level security;
alter table public.character_resources enable row level security;
alter table public.matches enable row level security;
alter table public.match_members enable row level security;
alter table public.match_characters enable row level security;
alter table public.character_runtime enable row level security;
alter table public.checks enable row level security;
alter table public.check_targets enable row level security;
alter table public.check_responses enable row level security;
alter table public.match_events enable row level security;

-- Helper: miembros de partida
create or replace function public.is_match_member(p_match uuid, p_user uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_members m
    where m.match_id = p_match and m.user_id = p_user
  );
$$;

create or replace function public.is_match_master(p_match uuid, p_user uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matches x
    where x.id = p_match and x.master_user_id = p_user
  );
$$;

-- profiles (propio + compañeros de misma partida para ver nombres en mesa)
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles_select_matchmates"
on public.profiles for select
using (
  exists (
    select 1 from public.match_members me
    join public.match_members them on them.match_id = me.match_id
    where me.user_id = auth.uid()
      and them.user_id = profiles.id
  )
);

create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- characters
create policy "characters_owner_all"
on public.characters for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

-- character_stats / resources: dueño del personaje
create policy "character_stats_owner"
on public.character_stats for all
using (
  exists (
    select 1 from public.characters c
    where c.id = character_stats.character_id and c.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.characters c
    where c.id = character_stats.character_id and c.owner_user_id = auth.uid()
  )
);

create policy "character_resources_owner"
on public.character_resources for all
using (
  exists (
    select 1 from public.characters c
    where c.id = character_resources.character_id and c.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.characters c
    where c.id = character_resources.character_id and c.owner_user_id = auth.uid()
  )
);

-- matches: master o miembro lee
create policy "matches_select_member"
on public.matches for select
using (
  master_user_id = auth.uid()
  or public.is_match_member(id, auth.uid())
);

create policy "matches_insert_master_self"
on public.matches for insert
with check (master_user_id = auth.uid());

create policy "matches_update_master"
on public.matches for update
using (master_user_id = auth.uid())
with check (master_user_id = auth.uid());

-- match_members
create policy "match_members_select_if_member"
on public.match_members for select
using (
  public.is_match_member(match_id, auth.uid())
);

create policy "match_members_insert_master"
on public.match_members for insert
with check (public.is_match_master(match_id, auth.uid()));

create policy "match_members_update_master"
on public.match_members for update
using (public.is_match_master(match_id, auth.uid()));

create policy "match_members_delete_master"
on public.match_members for delete
using (public.is_match_master(match_id, auth.uid()));

-- match_characters
create policy "match_characters_select_member"
on public.match_characters for select
using (public.is_match_member(match_id, auth.uid()));

create policy "match_characters_write_master"
on public.match_characters for insert
with check (public.is_match_master(match_id, auth.uid()));

create policy "match_characters_update_master"
on public.match_characters for update
using (public.is_match_master(match_id, auth.uid()));

create policy "match_characters_delete_master"
on public.match_characters for delete
using (public.is_match_master(match_id, auth.uid()));

-- character_runtime: lectura miembros; escritura master siempre; jugador limitado (MVP: solo master edita runtime)
create policy "character_runtime_select_member"
on public.character_runtime for select
using (public.is_match_member(match_id, auth.uid()));

create policy "character_runtime_write_master"
on public.character_runtime for insert
with check (public.is_match_master(match_id, auth.uid()));

create policy "character_runtime_update_master"
on public.character_runtime for update
using (public.is_match_master(match_id, auth.uid()));

create policy "character_runtime_delete_master"
on public.character_runtime for delete
using (public.is_match_master(match_id, auth.uid()));

-- checks
create policy "checks_select_member"
on public.checks for select
using (public.is_match_member(match_id, auth.uid()));

create policy "checks_insert_master"
on public.checks for insert
with check (
  public.is_match_master(match_id, auth.uid())
  and created_by_user_id = auth.uid()
);

create policy "checks_update_master"
on public.checks for update
using (public.is_match_master(match_id, auth.uid()));

-- check_targets
create policy "check_targets_select_member"
on public.check_targets for select
using (
  exists (
    select 1 from public.checks ch
    where ch.id = check_targets.check_id
      and public.is_match_member(ch.match_id, auth.uid())
  )
);

create policy "check_targets_insert_master"
on public.check_targets for insert
with check (
  exists (
    select 1 from public.checks ch
    where ch.id = check_targets.check_id
      and public.is_match_master(ch.match_id, auth.uid())
  )
);

create policy "check_targets_update_participant"
on public.check_targets for update
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.checks ch
    where ch.id = check_targets.check_id
      and public.is_match_master(ch.match_id, auth.uid())
  )
);

-- check_responses
create policy "check_responses_select_member"
on public.check_responses for select
using (
  exists (
    select 1 from public.checks ch
    where ch.id = check_responses.check_id
      and public.is_match_member(ch.match_id, auth.uid())
  )
);

create policy "check_responses_insert_target"
on public.check_responses for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.check_targets t
    join public.checks ch on ch.id = t.check_id
    where t.check_id = check_responses.check_id
      and t.user_id = auth.uid()
      and t.character_id = check_responses.character_id
      and ch.status = 'open'
  )
);

create policy "check_responses_update_master"
on public.check_responses for update
using (
  exists (
    select 1 from public.checks ch
    where ch.id = check_responses.check_id
      and public.is_match_master(ch.match_id, auth.uid())
  )
);

-- match_events
create policy "match_events_select_member"
on public.match_events for select
using (public.is_match_member(match_id, auth.uid()));

create policy "match_events_insert_member_actor"
on public.match_events for insert
with check (
  public.is_match_member(match_id, auth.uid())
  and (actor_user_id is null or actor_user_id = auth.uid())
);

-- Realtime (Supabase cloud): si falla por tablas ya publicadas, ejecutar solo las faltantes desde SQL editor.
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.character_runtime;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.checks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.check_targets;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.check_responses;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.match_events;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.match_members;
exception when duplicate_object then null; end $$;
