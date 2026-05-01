-- Personaje "Fish" por defecto (stats de la hoja de referencia) para cuentas concretas.
-- Requiere que esos usuarios ya existan en auth.users (registro previo).
-- Si el email de usuarionxn2026 es otro, editá el array `emails` abajo y volvé a ejecutar.

do $$
declare
  emails text[] := array[
    'dalfoenrique@gmail.com',
    'usuarionxn2026@gmail.com'
  ];
  em text;
  uid uuid;
  cid uuid;
  fish_exists boolean;
begin
  foreach em in array emails
  loop
    select au.id into uid
    from auth.users au
    where lower(trim(au.email)) = lower(trim(em))
    limit 1;

    if uid is null then
      raise notice 'Fish seed: sin usuario para %', em;
      continue;
    end if;

    select exists (
      select 1
      from public.characters ch
      where ch.owner_user_id = uid
        and lower(trim(ch.name)) = 'fish'
        and ch.is_archived = false
    ) into fish_exists;

    if fish_exists then
      raise notice 'Fish seed: ya existe Fish para %', em;
      continue;
    end if;

    insert into public.characters (name, owner_user_id)
    values ('Fish', uid)
    returning id into cid;

    insert into public.character_stats (character_id, stat_key, stat_label, die_size, base_modifier) values
      (cid, 'brawn'::public.stat_key, 'Brawn', '4'::public.die_size, 0),
      (cid, 'brains'::public.stat_key, 'Brains', '20'::public.die_size, 0),
      (cid, 'fight'::public.stat_key, 'Fight', '10'::public.die_size, 0),
      (cid, 'flight'::public.stat_key, 'Flight', '8'::public.die_size, 0),
      (cid, 'charm'::public.stat_key, 'Charm', '8'::public.die_size, 0),
      (cid, 'grit'::public.stat_key, 'Grit', '12'::public.die_size, 0);

    insert into public.character_resources (character_id, starting_tokens, notes)
    values (cid, 5, 'seed Fish');

    raise notice 'Fish seed: creado Fish (%) para %', cid, em;
  end loop;
end;
$$;
