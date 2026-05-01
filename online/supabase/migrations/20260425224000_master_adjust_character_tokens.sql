-- Permite al master ajustar fichas con delta positivo o negativo.
-- Conserva límites por operación y evita que el saldo quede en negativo.

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
  v_next_tokens integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_amount is null or p_amount = 0 or abs(p_amount) > 500 then
    raise exception 'invalid_token_amount';
  end if;

  select * into m
  from public.matches
  where id = p_match_id
  for share;
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

  v_next_tokens := rt.current_tokens + p_amount;
  if v_next_tokens < 0 then
    raise exception 'insufficient_tokens';
  end if;

  update public.character_runtime
  set
    current_tokens = v_next_tokens,
    version = rt.version + 1,
    updated_at = now()
  where id = rt.id;

  return jsonb_build_object(
    'current_tokens', v_next_tokens,
    'granted', p_amount
  );
end;
$$;

comment on function public.master_grant_character_tokens(uuid, uuid, integer) is
  'Solo el master de la partida: ajusta fichas (+/-) del character_runtime del personaje en esa mesa, sin permitir saldo negativo.';
