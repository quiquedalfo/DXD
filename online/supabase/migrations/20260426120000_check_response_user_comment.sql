alter table public.check_responses
  add column if not exists user_comment text;

comment on column public.check_responses.user_comment is
  'Comentario opcional escrito por el jugador al enviar la respuesta del check.';

create or replace function public.submit_check_response(
  p_check_id uuid,
  p_character_id uuid,
  p_roll_value integer,
  p_tokens_spent integer default 0,
  p_modifier_applied integer default 0,
  p_explosion_mode text default 'spec',
  p_explosion_steps jsonb default '[]'::jsonb,
  p_user_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_resp_id uuid;
begin
  v_result := public.submit_check_response(
    p_check_id,
    p_character_id,
    p_roll_value,
    p_tokens_spent,
    p_modifier_applied,
    p_explosion_mode,
    p_explosion_steps
  );

  v_resp_id := (v_result ->> 'response_id')::uuid;
  if v_resp_id is not null then
    update public.check_responses
    set user_comment = nullif(btrim(coalesce(p_user_comment, '')), '')
    where id = v_resp_id;
  end if;

  return v_result;
end;
$$;

comment on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb, text) is
  'Wrapper que delega a submit_check_response(...) y guarda comentario opcional del jugador.';

revoke all on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb, text) from public;
grant execute on function public.submit_check_response(uuid, uuid, integer, integer, integer, text, jsonb, text) to authenticated;
