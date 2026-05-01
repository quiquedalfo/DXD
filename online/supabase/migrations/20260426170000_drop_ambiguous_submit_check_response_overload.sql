-- Evita ambigüedad de PostgREST entre sobrecargas de submit_check_response(...)
-- Nos quedamos con:
--   1) submit_check_response(...) base (sin comentario)
--   2) submit_check_response_with_comment(...) nombre único

drop function if exists public.submit_check_response(
  uuid,
  uuid,
  integer,
  integer,
  integer,
  text,
  jsonb,
  text
);
