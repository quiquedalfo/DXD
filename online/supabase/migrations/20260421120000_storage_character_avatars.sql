-- Bucket público para retratos de personajes (app sube JPG bajo `{owner_user_id}/{character_id}.jpg`).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'character-avatars',
  'character-avatars',
  true,
  5242880,
  array['image/jpeg']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública (URL en characters.avatar_url)
drop policy if exists "character_avatars_public_read" on storage.objects;
create policy "character_avatars_public_read"
on storage.objects for select
to public
using (bucket_id = 'character-avatars');

drop policy if exists "character_avatars_owner_insert" on storage.objects;
create policy "character_avatars_owner_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'character-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "character_avatars_owner_update" on storage.objects;
create policy "character_avatars_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'character-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'character-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "character_avatars_owner_delete" on storage.objects;
create policy "character_avatars_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'character-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
