-- ResenhaON persistent tournament/ranking foundation.
-- Safe to run on an existing Supabase project: it only creates missing columns/tables/indexes.

create extension if not exists pgcrypto;

create table if not exists players (
  id text primary key,
  google_id text,
  name text not null default 'Jogador',
  email text,
  avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table if exists players add column if not exists google_id text;
alter table if exists players add column if not exists name text not null default 'Jogador';
alter table if exists players add column if not exists email text;
alter table if exists players add column if not exists avatar text;
alter table if exists players add column if not exists created_at timestamptz not null default now();
alter table if exists players add column if not exists updated_at timestamptz not null default now();
alter table if exists players add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists tournaments (
  id text primary key,
  type text not null default 'swiss',
  name text not null,
  owner_id text,
  status text not null default 'registration_open',
  format text not null default 'BO3',
  invite_code text,
  max_players integer not null default 8,
  rounds_total integer not null default 3,
  current_round integer not null default 0,
  current_champion_id text,
  current_match_id text,
  champion_id text,
  is_ranked_requested boolean not null default true,
  hall_of_fame_status jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table if exists tournaments add column if not exists type text not null default 'swiss';
alter table if exists tournaments add column if not exists owner_id text;
alter table if exists tournaments add column if not exists status text not null default 'registration_open';
alter table if exists tournaments add column if not exists format text not null default 'BO3';
alter table if exists tournaments add column if not exists invite_code text;
alter table if exists tournaments add column if not exists max_players integer not null default 8;
alter table if exists tournaments add column if not exists rounds_total integer not null default 3;
alter table if exists tournaments add column if not exists current_round integer not null default 0;
alter table if exists tournaments add column if not exists current_champion_id text;
alter table if exists tournaments add column if not exists current_match_id text;
alter table if exists tournaments add column if not exists champion_id text;
alter table if exists tournaments add column if not exists is_ranked_requested boolean not null default true;
alter table if exists tournaments add column if not exists hall_of_fame_status jsonb not null default '{}'::jsonb;
alter table if exists tournaments add column if not exists state jsonb not null default '{}'::jsonb;
alter table if exists tournaments add column if not exists created_at timestamptz not null default now();
alter table if exists tournaments add column if not exists updated_at timestamptz not null default now();
alter table if exists tournaments add column if not exists finished_at timestamptz;

create table if not exists tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null,
  player_id text not null,
  name text not null default 'Jogador',
  email text,
  avatar text,
  status text not null default 'active',
  points integer not null default 0,
  match_points integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

alter table if exists tournament_players add column if not exists status text not null default 'active';
alter table if exists tournament_players add column if not exists current_streak integer not null default 0;
alter table if exists tournament_players add column if not exists best_streak integer not null default 0;
alter table if exists tournament_players add column if not exists stats jsonb not null default '{}'::jsonb;

create table if not exists matches (
  id text primary key,
  tournament_id text,
  room_id text,
  round_id text,
  round_number integer,
  table_number integer,
  player1_id text,
  player2_id text,
  winner_id text,
  status text not null default 'pending',
  result text,
  player1_game_wins integer,
  player2_game_wins integer,
  result_label text,
  is_draw boolean not null default false,
  is_bye boolean not null default false,
  reported_by text,
  reported_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists matches add column if not exists payload jsonb not null default '{}'::jsonb;
alter table if exists matches add column if not exists reported_by text;
alter table if exists matches add column if not exists reported_at timestamptz;
alter table if exists matches add column if not exists result_label text;

create table if not exists tournament_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null,
  match_id text not null,
  result text not null,
  player1_game_wins integer,
  player2_game_wins integer,
  winner_id text,
  reported_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists tournament_results add column if not exists payload jsonb not null default '{}'::jsonb;

create table if not exists ranking (
  player_id text primary key,
  name text not null default 'Jogador',
  avatar text,
  total_points integer not null default 0,
  total_matches integer not null default 0,
  total_wins integer not null default 0,
  total_draws integer not null default 0,
  total_losses integer not null default 0,
  win_rate numeric not null default 0,
  titles integer not null default 0,
  runner_ups integer not null default 0,
  participations integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table if exists ranking add column if not exists stats jsonb not null default '{}'::jsonb;
alter table if exists ranking add column if not exists runner_ups integer not null default 0;
alter table if exists ranking add column if not exists participations integer not null default 0;

create table if not exists tournament_snapshots (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null,
  status text,
  reason text,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  tournament_id text,
  match_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tournaments_status on tournaments(status);
create index if not exists idx_tournaments_updated_at on tournaments(updated_at desc);
create unique index if not exists idx_players_id_unique on players(id);
create unique index if not exists idx_tournaments_id_unique on tournaments(id);
create unique index if not exists idx_tournament_players_unique_player on tournament_players(tournament_id, player_id);
create unique index if not exists idx_matches_id_unique on matches(id);
create unique index if not exists idx_ranking_player_unique on ranking(player_id);
create index if not exists idx_tournament_players_tournament on tournament_players(tournament_id);
create index if not exists idx_matches_tournament on matches(tournament_id);
create index if not exists idx_tournament_results_tournament on tournament_results(tournament_id);
create index if not exists idx_tournament_snapshots_tournament on tournament_snapshots(tournament_id, created_at desc);
create index if not exists idx_audit_logs_tournament on audit_logs(tournament_id, created_at desc);
