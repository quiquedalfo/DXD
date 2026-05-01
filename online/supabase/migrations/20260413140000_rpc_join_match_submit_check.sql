-- RPCs MVP: unirse por código + enviar respuesta de check (transacción atómica, SECURITY DEFINER).

create or replace function public.join_match_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'empty_code';
  end if;

  select * into m
  from public.matches
  where upper(trim(code)) = upper(trim(p_code))
  limit 1;

  if not found then
    raise exception 'invalid_code';
  end if;

  if m.status not in (
    'draft'::public.match_status,
    'live'::public.match_status,
    'paused'::public.match_status
  ) then
    raise exception 'match_not_joinable';
  end if;

  if uid = m.master_user_id then
    insert into public.match_members (match_id, user_id, role)
    values (m.id, uid, 'master'::public.match_member_role)
    on conflict (match_id, user_id) do nothing;
  else
    insert into public.match_members (match_id, user_id, role)
    values (m.id, uid, 'player'::public.match_member_role)
    on conflict (match_id, user_id) do nothing;
  end if;

  return m.id;
end;
$$;

comment on function public.join_match_with_code(text) is
  'Une auth.uid() a una partida por código corto. El master entra como role master; el resto como player. Idempotente.';

create or replace function public.submit_check_response(
  p_check_id uuid,
  p_character_id uuid,
  p_roll_value integer,
  p_tokens_spent integer default 0,
  p_modifier_applied integer default 0,
  p_explosion_mode text default 'spec'
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
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_explosion_mode is not null
     and p_explosion_mode not in ('spec', 'desktop') then
    raise exception 'invalid_explosion_mode';
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

  if v_check.allow_token_spend then
    if p_tokens_spent < 0 or p_tokens_spent > v_rt.current_tokens then
      raise exception 'invalid_token_spend';
    end if;
  end if;

  v_total := p_roll_value + coalesce(p_tokens_spent, 0) + coalesce(p_modifier_applied, 0);

  if v_total >= v_check.check_value then
    v_outcome := 'pass'::public.check_response_outcome;
  else
    v_outcome := 'fail'::public.check_response_outcome;
  end if;

  v_margin := v_total - v_check.check_value;

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
    explosion_flag
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
    v_explosion
  )
  returning id into v_resp_id;

  update public.check_targets
  set
    response_status = 'submitted'::public.check_target_response_status,
    responded_at = now()
  where id = v_target.id;

  update public.character_runtime
  set
    current_tokens = v_rt.current_tokens - coalesce(p_tokens_spent, 0),
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
      'explosion_flag', v_explosion
    )
  );

  return jsonb_build_object(
    'response_id', v_resp_id,
    'computed_total', v_total,
    'outcome', v_outcome::text,
    'margin', v_margin,
    'explosion_flag', v_explosion,
    'check_status', case when v_pending = 0 then 'answered' else 'open' end
  );
end;
$$;

comment on function public.submit_check_response(uuid, uuid, integer, integer, integer, text) is
  'Inserta respuesta, actualiza target + runtime y opcionalmente cierra el check si no quedan pendientes. explosion_mode: spec | desktop.';

create or replace function public.create_match(p_title text, p_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mid uuid := gen_random_uuid();
  c text;
  tries int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  c := nullif(trim(both from coalesce(p_code, '')), '');
  if c is not null and length(c) < 3 then
    raise exception 'code_too_short';
  end if;

  if c is null then
    loop
      c := upper(substring(md5((random()::text || clock_timestamp()::text)) from 1 for 6));
      exit when not exists (select 1 from public.matches m where m.code = c);
      tries := tries + 1;
      if tries > 50 then
        raise exception 'code_gen_failed';
      end if;
    end loop;
  end if;

  begin
    insert into public.matches (id, code, title, master_user_id, status)
    values (
      mid,
      c,
      coalesce(nullif(trim(both from p_title), ''), 'Partida'),
      uid,
      'draft'::public.match_status
    );
  exception when unique_violation then
    raise exception 'code_already_used';
  end;

  insert into public.match_members (match_id, user_id, role)
  values (mid, uid, 'master'::public.match_member_role);

  insert into public.match_events (match_id, actor_user_id, event_type, entity_type, entity_id, payload_json)
  values (
    mid,
    uid,
    'match_created',
    'match',
    mid,
    jsonb_build_object('title', coalesce(nullif(trim(both from p_title), ''), 'Partida'), 'code', c)
  );

  return mid;
end;
$$;

comment on function public.create_match(text, text) is
  'Crea partida en draft, inserta al master en match_members y deja código único (proporcionado o autogenerado).';

revoke all on function public.join_match_with_code(text) from public;
revoke all on function public.submit_check_response(uuid, uuid, integer, integer, integer, text) from public;
revoke all on function public.create_match(text, text) from public;

grant execute on function public.join_match_with_code(text) to authenticated;
grant execute on function public.submit_check_response(uuid, uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.create_match(text, text) to authenticated;
