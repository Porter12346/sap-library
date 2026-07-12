create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

create table if not exists replays (
  id uuid primary key default uuid_generate_v4(),
  participation_id text unique not null,
  match_id text,
  player_name text,
  opponent_name text,
  pack text,
  opponent_pack text,
  game_version text,
  max_lives int,
  mode int,
  match_type text,
  match_name text,
  match_pack int,
  max_player_count int,
  active_player_count int,
  spectator_mode int,
  tags text[] default '{}'::text[],
  raw_json jsonb not null,
  created_at timestamptz default now()
);
alter table replays add column if not exists match_id text;
alter table replays add column if not exists player_id text;
alter table replays add column if not exists opponent_id text;
alter table replays add column if not exists opponent_participation_id text;
alter table replays add column if not exists opponent_raw_json jsonb;
alter table replays add column if not exists player_rank int;
alter table replays add column if not exists opponent_rank int;

create table if not exists turns (
  id uuid primary key default uuid_generate_v4(),
  replay_id uuid not null references replays(id) on delete cascade,
  turn_number int not null,
  outcome int not null,
  opponent_name text,
  player_lives int,
  player_gold_spent int,
  opponent_gold_spent int,
  player_rolls int,
  opponent_rolls int,
  player_summons int,
  opponent_summons int,
  unique (replay_id, turn_number)
);

create table if not exists pets (
  id uuid primary key default uuid_generate_v4(),
  replay_id uuid not null references replays(id) on delete cascade,
  turn_number int not null,
  side text not null check (side in ('player','opponent')),
  position int,
  pet_name text not null,
  level int,
  attack int,
  health int,
  perk text,
  toy text
);

-- Per-action player log decoded from raw_json (see lib/actions.js). Every row is
-- an action by the replay owner: buy, move, merge, buy_merge, sell, food. This
-- captures in-shop decisions that the board snapshots in `pets` cannot show.
create table if not exists actions (
  id uuid primary key default uuid_generate_v4(),
  replay_id uuid not null references replays(id) on delete cascade,
  turn_number int,
  seq int not null,
  action_type text not null check (action_type in ('buy','move','merge','buy_merge','sell','food')),
  pet_name text,
  target_pet_name text,
  food_name text,
  position int,
  unique (replay_id, seq)
);

create table if not exists hidden_players (
  player_id text primary key,
  reason text,
  hidden_by text,
  hidden_at timestamptz not null default now()
);

create table if not exists player_tags (
  player_id text primary key,
  tags text[] not null default '{}'::text[],
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_replays_participation_id on replays(participation_id);
create unique index if not exists idx_replays_match_id_unique on replays(match_id) where match_id is not null;
create index if not exists idx_replays_match_id on replays(match_id);
create index if not exists idx_replays_player_name on replays(player_name);
create index if not exists idx_replays_player_name_trgm on replays using gin (player_name gin_trgm_ops);
create index if not exists idx_replays_pack on replays(pack);
create index if not exists idx_replays_opponent_pack on replays(opponent_pack);
create index if not exists idx_replays_game_version on replays(game_version);
create index if not exists idx_replays_opponent_name on replays(opponent_name);
create index if not exists idx_replays_opponent_name_trgm on replays using gin (opponent_name gin_trgm_ops);
create index if not exists idx_replays_player_id on replays(player_id);
create index if not exists idx_replays_opponent_id on replays(opponent_id);
create index if not exists idx_replays_player_id_created_at on replays(player_id, created_at desc);
create index if not exists idx_replays_opponent_id_created_at on replays(opponent_id, created_at desc);
create index if not exists idx_replays_player_rank on replays(player_rank);
create index if not exists idx_replays_opponent_rank on replays(opponent_rank);
create index if not exists idx_replays_match_type on replays(match_type);
create index if not exists idx_replays_match_name_trgm on replays using gin (match_name gin_trgm_ops);
create index if not exists idx_replays_mode on replays(mode);
create index if not exists idx_replays_created_at_desc on replays(created_at desc);
create index if not exists idx_replays_tags on replays using gin (tags);
create index if not exists idx_turns_turn_number on turns(turn_number);
create index if not exists idx_turns_replay_id on turns(replay_id);
create index if not exists idx_turns_outcome on turns(outcome);
create index if not exists idx_turns_replay_turn_outcome on turns(replay_id, turn_number, outcome);
create index if not exists idx_turns_replay_turn_desc on turns(replay_id, turn_number desc) include (outcome);
create index if not exists idx_pets_pet_name on pets(pet_name);
create index if not exists idx_pets_perk on pets(perk);
create index if not exists idx_pets_toy on pets(toy);
create index if not exists idx_pets_position on pets(position);
create index if not exists idx_pets_turn_number on pets(turn_number);
create index if not exists idx_pets_replay_id on pets(replay_id);
create index if not exists idx_pets_replay_turn_side_pet on pets(replay_id, turn_number, side, pet_name);
create index if not exists idx_pets_replay_turn_side_perk on pets(replay_id, turn_number, side, perk) where perk is not null;
create index if not exists idx_pets_replay_turn_side_toy on pets(replay_id, turn_number, side, toy) where toy is not null;
create index if not exists idx_actions_replay_id on actions(replay_id);
create index if not exists idx_actions_type on actions(action_type);
create index if not exists idx_actions_pet_name on actions(pet_name) where pet_name is not null;
create index if not exists idx_actions_food_name on actions(food_name) where food_name is not null;
create index if not exists idx_actions_replay_type_pet on actions(replay_id, action_type, pet_name);
create index if not exists idx_replays_stats_scope on replays(match_type, pack, opponent_pack, created_at desc);
create index if not exists idx_hidden_players_hidden_at on hidden_players(hidden_at desc);
create index if not exists idx_player_tags_tags on player_tags using gin (tags);
create index if not exists idx_player_tags_updated_at on player_tags(updated_at desc);
