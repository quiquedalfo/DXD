-- Enum compartido por `characters.origin` y por RPC que devuelven `character_origin`.
-- Archivo corto para que ejecute antes que `20260501180000_character_origin_npc_pet.sql`.

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'character_origin'
  ) then
    create type public.character_origin as enum ('user', 'master_npc', 'master_pet');
  end if;
end;
$$;
