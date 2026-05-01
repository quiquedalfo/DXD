-- Progreso por stat: trained_in (+1, 3 fichas) → studied_in (+3, 4 fichas) → master_in (+5, 5 fichas).
-- Fichas en `character_runtime.current_tokens`; el master las otorga por RPC.

do $$
begin
  create type public.stat_training_tier as enum ('none', 'trained_in', 'studied_in', 'master_in');
exception
  when duplicate_object then null;
end $$;

alter table public.character_stats
  add column if not exists training_tier public.stat_training_tier not null default 'none';

comment on column public.character_stats.training_tier is
  'Progreso de entrenamiento en ese stat: none → trained (+1) → studied (+3) → master (+5). Modificador de tirada = base_modifier + valor del tier.';

create or replace function public.stat_training_modifier(p_tier public.stat_training_tier)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'none'::public.stat_training_tier then 0
    when 'trained_in'::public.stat_training_tier then 1
    when 'studied_in'::public.stat_training_tier then 3
    when 'master_in'::public.stat_training_tier then 5
  end;
$$;

create or replace function public._stat_training_next_tier(p_cur public.stat_training_tier)
returns public.stat_training_tier
language sql
immutable
as $$
  select case p_cur
    when 'none'::public.stat_training_tier then 'trained_in'::public.stat_training_tier
    when 'trained_in'::public.stat_training_tier then 'studied_in'::public.stat_training_tier
    when 'studied_in'::public.stat_training_tier then 'master_in'::public.stat_training_tier
    else null::public.stat_training_tier
  end;
$$;

create or replace function public._stat_training_tier_cost(p_target public.stat_training_tier)
returns integer
language sql
immutable
as $$
  select case p_target
    when 'trained_in'::public.stat_training_tier then 3
    when 'studied_in'::public.stat_training_tier then 4
    when 'master_in'::public.stat_training_tier then 5
    else null::integer
  end;
$$;

-- Master: suma fichas al runtime del personaje en esa partida.
create or replace function public.master_grant_character_tokens(
  p_match_id uuid,
  p_character_id uuid,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches%rowtype;
  rt public.character_runtime%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 500 then
    raise exception 'invalid_token_amount';
  end if;

  select * into m from public.matches where id = p_match_id for share;
  if not found then
    raise exception 'match_not_found';
  end if;
  if m.master_user_id <> uid then
    raise exception 'not_match_master';
  end if;

  select * into rt
  from public.character_runtime
  where match_id = p_match_id
    and character_id = p_character_id
  for update;
  if not found then
    raise exception 'missing_character_runtime';
  end if;

  update public.character_runtime
  set
    current_tokens = rt.current_tokens + p_amount,
    version = rt.version + 1,
    updated_at = now()
  where id = rt.id;

  return jsonb_build_object(
    'current_tokens', rt.current_tokens + p_amount,
    'granted', p_amount
  );
end;
$$;

comment on function public.master_grant_character_tokens(uuid, uuid, integer) is
  'Solo el master de la partida: suma fichas al character_runtime del personaje en esa mesa.';

revoke all on function public.master_grant_character_tokens(uuid, uuid, integer) from public;
grant execute on function public.master_grant_character_tokens(uuid, uuid, integer) to authenticated;

-- Dueño del personaje en mesa: sube un nivel de entrenamiento en un stat pagando fichas del runtime.
create or replace function public.purchase_next_stat_training(
  p_match_id uuid,
  p_character_id uuid,
  p_stat_key public.stat_key
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_next public.stat_training_tier;
  v_cost int;
  v_cur public.stat_training_tier;
  rt public.character_runtime%rowtype;
  cs_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.characters ch
    where ch.id = p_character_id
      and ch.owner_user_id = uid
      and ch.is_archived = false
  ) then
    raise exception 'not_character_owner';
  end if;

  if not exists (
    select 1 from public.match_characters mc
    where mc.match_id = p_match_id
      and mc.character_id = p_character_id
      and mc.user_id = uid
      and mc.is_active = true
  ) then
    raise exception 'character_not_assigned';
  end if;

  select id, training_tier into cs_id, v_cur
  from public.character_stats
  where character_id = p_character_id
    and stat_key = p_stat_key
  for update;
  if not found then
    raise exception 'missing_character_stat';
  end if;

  v_next := public._stat_training_next_tier(v_cur);
  if v_next is null then
    raise exception 'training_already_max';
  end if;

  v_cost := public._stat_training_tier_cost(v_next);
  if v_cost is null then
    raise exception 'invalid_training_cost';
  end if;

  select * into rt
  from public.character_runtime
  where match_id = p_match_id
    and character_id = p_character_id
  for update;
  if not found then
    raise exception 'missing_character_runtime';
  end if;

  if rt.current_tokens < v_cost then
    raise exception 'insufficient_tokens';
  end if;

  update public.character_stats
  set
    training_tier = v_next,
    updated_at = now()
  where id = cs_id;

  update public.character_runtime
  set
    current_tokens = rt.current_tokens - v_cost,
    version = rt.version + 1,
    updated_at = now()
  where id = rt.id;

  return jsonb_build_object(
    'stat_key', p_stat_key,
    'training_tier', v_next,
    'tokens_spent', v_cost,
    'current_tokens', rt.current_tokens - v_cost,
    'training_modifier', public.stat_training_modifier(v_next)
  );
end;
$$;

comment on function public.purchase_next_stat_training(uuid, uuid, public.stat_key) is
  'Dueño del personaje: paga 3/4/5 fichas del runtime para trained/studied/master en un stat.';

revoke all on function public.purchase_next_stat_training(uuid, uuid, public.stat_key) from public;
grant execute on function public.purchase_next_stat_training(uuid, uuid, public.stat_key) to authenticated;

-- Lista mesa: incluir fichas actuales del runtime (si hay personaje y runtime).
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
  last_seen_at timestamptz,
  runtime_tokens integer
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
    mm.last_seen_at,
    cr.current_tokens::integer as runtime_tokens
  from public.match_members mm
  join public.matches m on m.id = mm.match_id and m.master_user_id = auth.uid()
  join public.profiles pr on pr.id = mm.user_id
  left join public.characters c on c.id = mm.active_character_id and c.is_archived = false
  left join public.character_runtime cr
    on cr.match_id = mm.match_id
   and cr.character_id = c.id
  where mm.match_id = p_match_id
  order by
    case when mm.role = 'master'::public.match_member_role then 0 else 1 end,
    pr.username;
$$;

comment on function public.list_match_member_sheets_for_master(uuid) is
  'Solo el master: miembros + personaje activo + runtime_tokens (fichas en mesa).';

revoke all on function public.list_match_member_sheets_for_master(uuid) from public;
grant execute on function public.list_match_member_sheets_for_master(uuid) to authenticated;
