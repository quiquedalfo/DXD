-- El director puede borrar sus propias partidas (cascade limpia miembros, checks, invitaciones, etc.).

create policy "matches_delete_master"
on public.matches for delete
using (master_user_id = auth.uid());

comment on policy "matches_delete_master" on public.matches is
  'Solo el creador de la partida puede eliminarla.';
