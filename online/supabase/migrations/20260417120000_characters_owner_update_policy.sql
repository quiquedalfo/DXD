-- Refuerzo RLS: policy explícita de UPDATE para dueños (algunos entornos raros con FOR ALL + cliente).
-- Idempotente.

drop policy if exists "characters_owner_update" on public.characters;

create policy "characters_owner_update"
on public.characters
for update
to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));
