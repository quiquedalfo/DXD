-- Permite al master leer stats de personajes activos en su partida.
-- Caso de uso: panel web del master (grilla de jugadores) debe mostrar stats de todos.

drop policy if exists "character_stats_select_master_match_active" on public.character_stats;

create policy "character_stats_select_master_match_active"
on public.character_stats
for select
to authenticated
using (
  exists (
    select 1
    from public.match_characters mc
    join public.matches m on m.id = mc.match_id
    where mc.character_id = character_stats.character_id
      and mc.is_active = true
      and m.master_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.active_character_id = character_stats.character_id
      and m.master_user_id = auth.uid()
  )
);

comment on policy "character_stats_select_master_match_active" on public.character_stats is
  'Master autenticado puede leer stats de personajes activos/asignados en sus partidas.';
