-- Si el check falla, el personaje gana +1 ficha en mesa (después de aplicar gasto de fichas en la tirada).

create or replace function public.submit_check_response(
  p_check_id uuid,
  p_character_id uuid,
  p_roll_value integer,
  p_tokens_spent integer default 0,
  p_modifier_applied integer default 0,
  p_explosion_mode text default 'spec',
  p_explosion_steps jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_check public.checks%rowtype;
  v_target public.check_targets%rowtype;
  v_rt public.character_runtime%rowtype;
  v_die public.die_size;
  v_die_max int;
  v_total int;
  v_outcome public.check_response_outcome;
  v_margin int;
  v_explosion boolean;
  v_resp_id uuid;
  v_pending int;
  v_extra int := 0;
  v_len int;
  v_i int;
  v_step jsonb;
  v_sr int;
  v_st int;
  v_tokens_all int;
  v_fail_token_reward int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_explosion_mode is not null
     and p_explosion_mode not in ('spec', 'desktop') then
    raise exception 'invalid_explosion_mode';
  end if;

  if p_explosion_steps is null or jsonb_typeof(p_explosion_steps) <> 'array' then
    raise exception 'invalid_explosion_steps';
  end if;

  select * into v_check
  from public.checks
  where id = p_check_id
  for update;

  if not found then
    raise exception 'check_not_found';
  end if;

  if v_check.status <> 'open'::public.check_entity_status then
    raise exception 'check_not_open';
  end if;

  select * into v_target
  from public.check_targets
  where check_id = p_check_id
    and user_id = uid
    and character_id = p_character_id
  for update;

  if not found then
    raise exception 'not_a_target';
  end if;

  if v_target.response_status <> 'pending'::public.check_target_response_status then
    raise exception 'already_responded';
  end if;

  if not exists (
    select 1 from public.match_characters mc
    where mc.match_id = v_check.match_id
      and mc.user_id = uid
      and mc.character_id = p_character_id
      and mc.is_active = true
  ) then
    raise exception 'character_not_assigned';
  end if;

  if exists (
    select 1 from public.check_responses r
    where r.check_id = p_check_id
      and r.user_id = uid
      and r.character_id = p_character_id
  ) then
    raise exception 'duplicate_response';
  end if;

  if not v_check.allow_token_spend and coalesce(p_tokens_spent, 0) <> 0 then
    raise exception 'tokens_not_allowed';
  end if;

  if not v_check.allow_manual_modifier and coalesce(p_modifier_applied, 0) <> 0 then
    raise exception 'modifier_not_allowed';
  end if;

  select cs.die_size into v_die
  from public.character_stats cs
  where cs.character_id = p_character_id
    and cs.stat_key = v_check.stat_key
  limit 1;

  if not found then
    raise exception 'missing_character_stat';
  end if;

  v_die_max := (v_die::text)::int;

  select * into v_rt
  from public.character_runtime
  where match_id = v_check.match_id
    and character_id = p_character_id
  for update;

  if not found then
    raise exception 'missing_character_runtime';
  end if;

  if p_roll_value < 1 or p_roll_value > v_die_max then
    raise exception 'invalid_roll_value';
  end if;

  v_len := coalesce(jsonb_array_length(p_explosion_steps), 0);

  if (p_roll_value + coalesce(p_tokens_spent, 0) <> v_die_max) and v_len > 0 then
    raise exception 'explosion_steps_without_main_explosion';
  end if;

  if (p_roll_value + coalesce(p_tokens_spent, 0) = v_die_max) and v_len = 0 then
    raise exception 'incomplete_explosion_chain';
  end if;

  v_i := 0;
  while v_i < v_len loop
    v_step := p_explosion_steps -> v_i;
    v_sr := (v_step ->> 'roll')::int;
    v_st := coalesce((v_step ->> 'tokens')::int, 0);
    if v_sr < 1 or v_sr > v_die_max or v_st < 0 then
      raise exception 'invalid_explosion_step';
    end if;
    if v_i < v_len - 1 then
      if v_sr + v_st <> v_die_max then
        raise exception 'invalid_explosion_chain';
      end if;
    else
      if v_sr + v_st = v_die_max then
        raise exception 'incomplete_explosion_chain';
      end if;
    end if;
    v_extra := v_extra + v_sr + v_st;
    v_i := v_i + 1;
  end loop;

  v_tokens_all := coalesce(p_tokens_spent, 0);
  v_i := 0;
  while v_i < v_len loop
    v_step := p_explosion_steps -> v_i;
    v_tokens_all := v_tokens_all + coalesce((v_step ->> 'tokens')::int, 0);
    v_i := v_i + 1;
  end loop;

  if not v_check.allow_token_spend and v_tokens_all <> 0 then
    raise exception 'tokens_not_allowed';
  end if;

  if v_check.allow_token_spend then
    if p_tokens_spent < 0 or v_tokens_all > v_rt.current_tokens then
      raise exception 'invalid_token_spend';
    end if;
  end if;

  v_total := p_roll_value + coalesce(p_tokens_spent, 0) + coalesce(p_modifier_applied, 0) + v_extra;

  if v_total >= v_check.check_value then
    v_outcome := 'pass'::public.check_response_outcome;
  else
    v_outcome := 'fail'::public.check_response_outcome;
  end if;

  v_margin := v_total - v_check.check_value;

  if v_outcome = 'fail'::public.check_response_outcome then
    v_fail_token_reward := 1;
  end if;

  if coalesce(p_explosion_mode, 'spec') = 'desktop' then
    v_explosion := (p_roll_value + coalesce(p_tokens_spent, 0) = v_die_max);
  else
    v_explosion := (p_roll_value >= v_die_max);
  end if;

  insert into public.check_responses (
    check_id,
    user_id,
    character_id,
    stat_key,
    die_size_at_time,
    roll_value,
    tokens_spent,
    modifier_applied,
    computed_total,
    target_value,
    outcome,
    margin,
    explosion_flag,
    explosion_steps
  ) values (
    p_check_id,
    uid,
    p_character_id,
    v_check.stat_key,
    v_die,
    p_roll_value,
    coalesce(p_tokens_spent, 0),
    coalesce(p_modifier_applied, 0),
    v_total,
    v_check.check_value,
    v_outcome,
    v_margin,
    v_explosion,
    coalesce(p_explosion_steps, '[]'::jsonb)
  )
  returning id into v_resp_id;

  update public.check_targets
  set
    response_status = 'submitted'::public.check_target_response_status,
    responded_at = now()
  where id = v_target.id;

  update public.character_runtime
  set
    current_tokens = v_rt.current_tokens - v_tokens_all + v_fail_token_reward,
    last_roll_value = p_roll_value,
    last_total_value = v_total,
    last_result = case
      when v_outcome = 'pass'::public.check_response_outcome then 'pass'::public.roll_outcome
      else 'fail'::public.roll_outcome
    end,
    last_margin = v_margin,
    check_status = 'responded'::public.runtime_check_status,
    version = v_rt.version + 1,
    updated_at = now()
  where id = v_rt.id;

  select count(*)::int into v_pending
  from public.check_targets t
  where t.check_id = p_check_id
    and t.response_status = 'pending'::public.check_target_response_status;

  if v_pending = 0 then
    update public.checks
    set status = 'answered'::public.check_entity_status
    where id = p_check_id;
  end if;

  insert into public.match_events (match_id, actor_user_id, event_type, entity_type, entity_id, payload_json)
  values (
    v_check.match_id,
    uid,
    'check_response_submitted',
    'check_response',
    v_resp_id,
    jsonb_build_object(
      'check_id', p_check_id,
      'character_id', p_character_id,
      'computed_total', v_total,
      'outcome', v_outcome::text,
      'margin', v_margin,
      'explosion_flag', v_explosion,
      'explosion_steps', coalesce(p_explosion_steps, '[]'::jsonb),
      'fail_token_reward', v_fail_token_reward
    )
  );

  return jsonb_build_object(
    'response_id', v_resp_id,
    'computed_total', v_total,
    'outcome', v_outcome::text,
    'margin', v_margin,
    'explosion_flag', v_explosion,
    'fail_token_reward', v_fail_token_reward,
    'check_status', case when v_pending = 0 then 'answered' else 'open' end
  );
end;
$$;

comment on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb) is
  'Respuesta de check (explosión desktop opcional). Si el resultado es fallo, +1 ficha en mesa tras descontar fichas gastadas.';

revoke all on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb) from public;
grant execute on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb) to authenticated;
