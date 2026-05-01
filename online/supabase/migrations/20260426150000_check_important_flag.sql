alter table public.checks
  add column if not exists important boolean not null default false;

comment on column public.checks.important is
  'Marca de check importante seleccionada por el master desde la estrella en la UI.';
