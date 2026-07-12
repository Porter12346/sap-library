# SAP Replay Explorer

Web app that ingests Super Auto Pets replays by participation ID, stores them in Postgres, and lets you search by player, pack, pets, perks, or turn. It also renders the replay summary image using the original bot renderer.

## Setup

1) Install dependencies:
```powershell
npm install
```

2) Create `.env.local`:
```env
DATABASE_URL=postgresql://user:pass@host:port/db
SAP_EMAIL=your_sap_email
SAP_PASSWORD=your_sap_password

# Optional version controls
SAP_API_VERSION=47
# Optional pin for the site's "current" filter. If omitted, the site uses the highest version in your DB.
SAP_CURRENT_VERSION=47
SAP_API_VERSION_PROBE_AHEAD=2
SAP_API_VERSION_PROBE_BEHIND=8
```

3) Create tables:
```powershell
psql $env:DATABASE_URL -f schema.sql
```

If you already created tables, run this once in Neon SQL editor:
```sql
alter table replays add column if not exists game_version text;
alter table replays add column if not exists opponent_pack text;
alter table replays add column if not exists player_id text;
alter table replays add column if not exists opponent_id text;
alter table replays add column if not exists opponent_participation_id text;
alter table replays add column if not exists opponent_raw_json jsonb;
alter table replays add column if not exists player_rank int;
alter table replays add column if not exists opponent_rank int;
create index if not exists idx_replays_game_version on replays(game_version);
create index if not exists idx_replays_opponent_pack on replays(opponent_pack);
create index if not exists idx_replays_player_id on replays(player_id);
create index if not exists idx_replays_opponent_id on replays(opponent_id);
create index if not exists idx_replays_player_rank on replays(player_rank);
create index if not exists idx_replays_opponent_rank on replays(opponent_rank);
```

4) Run dev server:
```powershell
npm run dev
```

Open `http://localhost:3000`.

## API

- `POST /api/replays` with `{ "participationId": "..." }` to ingest a replay
- `GET /api/search?player=...&pack=...&pet=...&perk=...&turn=...` to search
- `GET /api/replays/:id/image` to render a replay image
- `GET /api/replays/:id/turns` to fetch full turn-level data (turn stats + pets by side/turn)
- `GET /api/replays/:id/calculator?turn=...` to generate a calculator link using both replay perspectives
- `GET /api/replays/:id/perspectives` to fetch the raw playback responses for both participation IDs

## Notes

- `canvas` may require build tools on Windows.
- The app logs into Teamwood to fetch a bearer token automatically using `SAP_EMAIL` and `SAP_PASSWORD`.
- Teamwood login will try the configured API version first, then probe nearby versions if the game has moved ahead.
- Replay fetch reuses that current auth token and probes nearby playback versions when Teamwood reports a playback/version mismatch.
- `SAP_CURRENT_VERSION` lets you pin what the site treats as the default "current" replay version filter. If omitted, the site uses the highest ingested replay version automatically.
- Very old replay versions can still become unavailable if Teamwood retires those playback endpoints entirely.
- To backfill version 45 rank + IDs after upgrading schema:
```powershell
npm run backfill:ranks-v45
```
- To backfill ranks/IDs for replays created in the last hour (all versions):
```powershell
npm run backfill:ranks-recent
```
