-- Ejecutar SOLO en SQL Editor cuando quieras limpiar pruebas.
-- Archiva (is_archived = true) TODOS los personajes cuyo nombre NO es "fish" (sin importar mayúsculas).
-- NO borra filas: evita romper FKs en partidas/checks.
--
-- Revisá el resultado con:
--   select name, is_archived from public.characters order by owner_user_id, name;

update public.characters
set is_archived = true
where is_archived = false
  and lower(trim(both from name)) <> 'fish';
