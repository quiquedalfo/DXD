-- Control de mejoras por fin de capítulo.
-- El master habilita la ventana de compra; fuera de esa ventana no se puede subir entrenamiento.

alter table public.matches
  add column if not exists chapter_upgrades_open boolean not null default false;

comment on column public.matches.chapter_upgrades_open is
  'Ventana de mejoras de capítulo abierta por el master. Mientras sea false, purchase_next_stat_training rechaza compras.';

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
  'Dueño del personaje: paga 3/4/5 fichas del runtime para trained/studied/master en un stat, solo cuando chapter_upgrades_open=true.';
