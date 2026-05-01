-- Tres tipos de personajes:
-- user = hoja del jugador (dueño usuário)
-- master_npc = creado por el master (solo stats), mesa como slots del director
-- master_pet = creado por el master (solo stats), cedido en match_characters a un jugador
--
-- Requiere migración anterior `20260501174500_character_origin_enum.sql` (tipo `character_origin`).
-- Si pegás este SQL solo en el Editor, ejecutá antes el enum o este bloque empieza a fallar en políticas/functions.

alter table public.characters
  add column if not exists origin public.character_origin not null default 'user';

comment on column public.characters.origin is
  'user: PJ del jugador · master_npc: NPC solo stats mesa director · master_pet: mismo pero cedible a jugador vía match_characters.';

update public.character_resources r
set notes = replace(coalesce(r.notes, ''), '[DXD_BLANK]', '[DXD_NPC]')
where r.notes is not null and r.notes like '%[DXD_BLANK]%';

-- PET primero si el recurso marcaba PET
update public.characters c
set origin = 'master_pet'::public.character_origin
from public.character_resources r
where r.character_id = c.id
  and strpos(coalesce(r.notes, ''), '[DXD_PET]') > 0;

-- Legacy: marcador NPC (antes «blank») → mesa director
update public.characters c
set origin = 'master_npc'::public.character_origin
from public.character_resources r
where r.character_id = c.id
  and c.origin = 'user'::public.character_origin
  and (
    strpos(coalesce(r.notes, ''), '[DXD_NPC]') > 0
  );

-- ── RLS: characters (dueño ó PET asignado en mesa) ──────────────────────────
drop policy if exists "characters_owner_all" on public.characters;
drop policy if exists "characters_select_eligible" on public.characters;
drop policy if exists "characters_insert_own" on public.characters;
drop policy if exists "characters_update_own" on public.characters;
drop policy if exists "characters_delete_own" on public.characters;

create policy "characters_select_eligible"
on public.characters
for select
to authenticated
using (
  owner_user_id = auth.uid()
  or (
    origin = 'master_pet'::public.character_origin
    and exists (
      select 1 from public.match_characters mc
      where mc.character_id = characters.id
        and mc.user_id = auth.uid()
        and mc.is_active = true
    )
  )
);

create policy "characters_insert_own"
on public.characters
for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy "characters_update_own"
on public.characters
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "characters_delete_own"
on public.characters
for delete
to authenticated
using (owner_user_id = auth.uid());

-- Lectura stats para PET concedido al jugador
drop policy if exists "character_stats_select_assigned_master_pet" on public.character_stats;

create policy "character_stats_select_assigned_master_pet"
on public.character_stats
for select
to authenticated
using (
  exists (
    select 1
    from public.characters ch
    join public.match_characters mc on mc.character_id = ch.id
    where ch.id = character_stats.character_id
      and ch.origin = 'master_pet'::public.character_origin
      and mc.user_id = auth.uid()
      and mc.is_active = true
  )
);

-- Lectura recursos (fichas iniciales / notas) para PET concedido
drop policy if exists "character_resources_select_assigned_master_pet" on public.character_resources;

create policy "character_resources_select_assigned_master_pet"
on public.character_resources
for select
to authenticated
using (
  exists (
    select 1
    from public.characters ch
    join public.match_characters mc on mc.character_id = ch.id
    where ch.id = character_resources.character_id
      and ch.origin = 'master_pet'::public.character_origin
      and mc.user_id = auth.uid()
      and mc.is_active = true
  )
);

-- ── set_player_active_character_for_match: PET vía match_characters ────────
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
  ) then
    raise exception 'not_a_member_in_match';
  end if;

  if not exists (
    select 1 from public.characters c
    where c.id = p_character_id
      and c.is_archived = false
      and (
        (
          c.origin = 'user'::public.character_origin
          and c.owner_user_id = uid
        )
        or (
          c.origin = 'master_pet'::public.character_origin
          and exists (
            select 1 from public.match_characters mc
            where mc.match_id = p_match_id
              and mc.user_id = uid
              and mc.character_id = p_character_id
              and mc.is_active = true
          )
        )
        or (
          c.origin = 'master_npc'::public.character_origin
          and c.owner_user_id = uid
        )
      )
  ) then
    raise exception 'character_not_owned';
  end if;

  update public.match_members mm
  set active_character_id = p_character_id
  where mm.match_id = p_match_id
    and mm.user_id = uid;

  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'match_member_update_expected_one_row got %', n;
  end if;
end;
$$;

comment on function public.set_player_active_character_for_match(uuid, uuid) is
  'Miembro: fija hoja activa (PJ propio, NPC del master en su propia fila, o PET cedido en match_characters).';

-- ── list_player_characters_for_master (PET bajo el jugador, no el dueño) ───
-- Postgres no permite cambiar el row type de RETURNS TABLE con CREATE OR REPLACE.
drop function if exists public.list_player_characters_for_master(uuid);

create function public.list_player_characters_for_master(p_match_id uuid)
returns table (
  character_id uuid,
  owner_user_id uuid,
  character_name text,
  owner_display text,
  character_origin public.character_origin
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as character_id,
    mm.user_id as owner_user_id,
    c.name as character_name,
    coalesce(nullif(trim(both from pr_mm.display_name), ''), pr_mm.username, '')::text as owner_display,
    c.origin as character_origin
  from public.match_members mm
  join public.matches m on m.id = mm.match_id and m.master_user_id = auth.uid()
  join public.profiles pr_mm on pr_mm.id = mm.user_id
  join public.characters c on c.id = mm.active_character_id and c.is_archived = false
  where mm.match_id = p_match_id
    and mm.role in ('player'::public.match_member_role, 'master'::public.match_member_role)
    and mm.active_character_id is not null
    and (
      (
        c.origin = 'user'::public.character_origin
        and c.owner_user_id = mm.user_id
      )
      or (
        c.origin = 'master_npc'::public.character_origin
        and mm.user_id = m.master_user_id
        and c.owner_user_id = m.master_user_id
      )
      or (
        c.origin = 'master_pet'::public.character_origin
        and mm.role = 'player'::public.match_member_role
        and exists (
          select 1 from public.match_characters mc
          where mc.match_id = p_match_id
            and mc.user_id = mm.user_id
            and mc.character_id = c.id
            and mc.is_active = true
        )
      )
    );
$$;

comment on function public.list_player_characters_for_master(uuid) is
  'Master: hojas activas de jugadores y del director; incluye PET cedido (owner del row = jugador que la usa).';

revoke all on function public.list_player_characters_for_master(uuid) from public;
grant execute on function public.list_player_characters_for_master(uuid) to authenticated;

-- ── list_match_member_sheets_for_master + character_origin ─────────────────
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
  runtime_tokens integer,
  character_origin text
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
    cr.current_tokens::integer as runtime_tokens,
    case when c.id is not null then c.origin::text else null end as character_origin
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
  'Master: miembros + hoja + runtime + origin (user / master_npc / master_pet).';

revoke all on function public.list_match_member_sheets_for_master(uuid) from public;
grant execute on function public.list_match_member_sheets_for_master(uuid) to authenticated;

-- ── purchase_next_stat_training: jugador puede comprar en PET cedido ───────
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
  m public.matches%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m
  from public.matches
  where id = p_match_id
  for share;
  if not found then
    raise exception 'match_not_found';
  end if;

  if not m.chapter_upgrades_open then
    raise exception 'chapter_upgrades_locked';
  end if;

  if not exists (
    select 1 from public.characters ch
    where ch.id = p_character_id
      and ch.is_archived = false
      and (
        ch.owner_user_id = uid
        or (
          ch.origin = 'master_pet'::public.character_origin
          and exists (
            select 1 from public.match_characters mc
            where mc.match_id = p_match_id
              and mc.character_id = p_character_id
              and mc.user_id = uid
              and mc.is_active = true
          )
        )
      )
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
  'PJ o PET concedido en mesa: compra TI/SI/MI con fichas de runtime cuando chapter_upgrades_open.';
