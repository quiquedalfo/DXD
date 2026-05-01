-- Cierre de ventana de mejoras:
-- al desactivar `chapter_upgrades_open`, las fichas de mesa sobrantes se pierden.

create or replace function public.close_chapter_upgrades_and_burn_leftover_tokens(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_match public.matches%rowtype;
  v_burned_rows int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.master_user_id <> uid then
    raise exception 'not_match_master';
  end if;

  update public.matches
  set chapter_upgrades_open = false
  where id = p_match_id;

  update public.character_runtime
  set
    current_tokens = 0,
    version = version + 1,
    updated_at = now()
  where match_id = p_match_id
    and current_tokens <> 0;

  get diagnostics v_burned_rows = row_count;

  return jsonb_build_object(
    'match_id', p_match_id,
    'chapter_upgrades_open', false,
    'burned_runtime_rows', v_burned_rows
  );
end;
$$;

comment on function public.close_chapter_upgrades_and_burn_leftover_tokens(uuid) is
  'Master-only: cierra la ventana de mejoras de capítulo y pone en 0 las fichas de mesa sobrantes (character_runtime.current_tokens) de la partida.';

revoke all on function public.close_chapter_upgrades_and_burn_leftover_tokens(uuid) from public;
grant execute on function public.close_chapter_upgrades_and_burn_leftover_tokens(uuid) to authenticated;
