-- Pegá esto solo en SQL Editor y ejecutá (no modifica nada).
-- 1) ¿Existen nuestras tablas en public?
select count(*)::int as tablas_dxds
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'characters', 'character_stats', 'matches',
    'match_members', 'checks', 'check_responses'
  );

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;

-- 2) ¿Están las RPC?
select p.proname as funcion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_match',
    'join_match_with_code',
    'submit_check_response',
    'list_player_characters_for_master',
    'list_match_member_sheets_for_master',
    'invite_player_to_match_by_email',
    'respond_match_invite',
    'set_player_active_character_for_match',
    'kick_member_from_match',
    'ping_match_presence',
    'leave_match_presence'
  )
order by 1;
