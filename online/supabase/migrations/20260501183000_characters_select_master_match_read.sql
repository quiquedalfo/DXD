-- Permite al director leer `characters` usados en su partida (misma idea que
-- `character_stats_select_master_match_active`). El panel master-web hace
-- SELECT directo al enriquecer mesa (`match_characters` + personajes de jugadores).

drop policy if exists "characters_select_master_match_active" on public.characters;

create policy "characters_select_master_match_active"
on public.characters
for select
to authenticated
using (
  exists (
    select 1
    from public.match_characters mc
    join public.matches m on m.id = mc.match_id
    where mc.character_id = characters.id
      and mc.is_active = true
      and m.master_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.match_members mm
    join public.matches m on m.id = mm.match_id
    where mm.active_character_id = characters.id
      and m.master_user_id = auth.uid()
  )
);

comment on policy "characters_select_master_match_active" on public.characters is
  'Director autenticado: lectura de personajes activos/asignados en sus partidas (web master + RPC complementos).';
