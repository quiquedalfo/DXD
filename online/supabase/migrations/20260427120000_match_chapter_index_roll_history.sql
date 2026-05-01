-- Capítulo narrativo por mesa: índice en `matches` y copia en cada respuesta de check al insertar.

alter table public.matches
  add column if not exists chapter_index integer not null default 1
  check (chapter_index >= 1);

comment on column public.matches.chapter_index is
  'Capítulo actual de la mesa (1-based). El master lo incrementa al pulsar «Terminar capítulo».';

alter table public.check_responses
  add column if not exists chapter_index integer not null default 1
  check (chapter_index >= 1);

comment on column public.check_responses.chapter_index is
  'Capítulo en el que se registró la tirada (valor de `matches.chapter_index` al insertar).';

create or replace function public.set_check_response_chapter_index()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  v_ch int;
begin
  select c.match_id into mid
  from public.checks c
  where c.id = new.check_id
  limit 1;

  if mid is null then
    new.chapter_index := coalesce(new.chapter_index, 1);
    return new;
  end if;

  select m.chapter_index into v_ch
  from public.matches m
  where m.id = mid;

  new.chapter_index := coalesce(v_ch, 1);
  return new;
end;
$$;

drop trigger if exists trg_check_responses_set_chapter on public.check_responses;

create trigger trg_check_responses_set_chapter
before insert on public.check_responses
for each row
execute procedure public.set_check_response_chapter_index();

comment on function public.set_check_response_chapter_index() is
  'Antes de insertar en check_responses, fija chapter_index según la partida del check.';
