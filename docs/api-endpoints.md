# API Endpoints

This file documents the HTTP endpoints currently implemented under `app/api`.

It also includes a short appendix for external Teamwood endpoints that this project integrates with or has verified during testing.

## Conventions

- Base path: `/api`
- Response format: JSON unless noted otherwise
- Dynamic route params are shown as `{id}`, `{playerId}`, `{runId}`, `{boardId}`
- Most read endpoints are cacheable and may return cache headers such as `Cache-Control` and `X-*-Cache`
- Some endpoints intentionally hide players that exist in the `hidden_players` table

## Quick Index

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Basic DB health/status |
| `/api/meta` | `GET` | Static metadata for packs, pets, perks, toys, versions |
| `/api/search` | `GET` | Replay search |
| `/api/stats` | `GET` | Aggregate pack, matchup, pet, perk, toy stats |
| `/api/replays` | `POST` | Ingest one replay by participation id |
| `/api/replays/bulk` | `POST` | Bulk ingest many participation ids |
| `/api/replays/{id}` | `GET`, `PATCH`, `POST` | Replay detail, tag replacement, or ingest alias |
| `/api/replays/{id}/turns` | `GET` | Expanded turn-by-turn replay view |
| `/api/replays/{id}/image` | `GET` | Render replay summary image |
| `/api/replays/{id}/calculator` | `GET` | Build calculator link for a replay turn |
| `/api/replays/{id}/perspectives` | `GET` | Return raw playback perspectives for both participation ids |
| `/api/player-tags` | `GET`, `POST`, `DELETE` | Manage per-player tags |
| `/api/hidden-players` | `GET`, `POST`, `DELETE` | Manage hidden players |
| `/api/profile/players` | `GET` | Profile player autocomplete/search |
| `/api/leaderboard` | `GET` | Global player leaderboard |
| `/api/leaderboard/{playerId}` | `GET` | Player-specific leaderboard summary |
| `/api/boards/runs` | `GET`, `POST` | Top boards run list and run creation |
| `/api/boards/runs/{runId}` | `GET` | Top boards run detail/progress |
| `/api/boards/top` | `GET` | Latest top boards for a scope |
| `/api/boards/top/{runId}` | `GET` | Top boards pinned to a run |
| `/api/boards/top/{runId}/{boardId}` | `GET` | Board detail plus matchups |

## Health And Metadata

### `GET /api/health`

Returns a simple DB check.

Example response:

```json
{
  "database": "postgres",
  "count": 12345
}
```

### `GET /api/meta`

Returns metadata used by the frontend.

Response keys:

- `pets`: pet metadata with `id`, `name`, `sprite`, `tier`, `packs`
- `perks`: perk metadata with `id`, `name`, `sprite`, `tier`, `packs`
- `toys`: toy metadata with `id`, `name`, `sprite`, `tier`, `packs`
- `packs`: pack id/name pairs
- `versions`: available game versions
- `currentVersion`: current/default version
- `seasons`: detected replay seasons

## Replay Search And Stats

### `GET /api/search`

Searches replay rows with filtering, pagination, and sorting.

Common query params:

- Identity:
  - `player`
  - `playerId`
  - `pid`
  - `opponent`
  - `opponentName`
- Pack/matchup:
  - `packA`
  - `packB`
  - `profilePlayerPack`
  - `profileOpponentPack`
  - `excludeA`
  - `excludeB`
  - `winningPack`
  - `losingPack`
  - `mirrorMatch=true`
  - `excludeMirrors=true`
- Replay metadata:
  - `season`
  - `lobbyCode`
  - `version`
  - `matchType` (repeatable or comma-separated)
  - `tags`
  - `minRank`
  - `minRankMode=any|both`
- Team filters:
  - `pet`
  - `perk`
  - `toy`
  - `petMode=any|all`
  - `perkMode=any|all`
  - `toyMode=any|all`
  - `petLevelName`
  - `petLevelMin`
  - `exactTeam` (comma-separated 5-pet team)
- Outcome/economy:
  - `outcome=win|loss|draw`
  - `outcomeTurn`
  - `minWins`
  - `goldMin`, `goldMax`
  - `rollsMin`, `rollsMax`
  - `summonsMin`, `summonsMax`
  - `econSide=either|player|opponent`
- Time/turn window:
  - `startDate`
  - `endDate`
  - `turn`
  - `minTurn`
  - `maxTurn`
- Pagination/sort:
  - `page` default `1`
  - `pageSize` default `10`, max `100`
  - `sort=created_at|player_name|pack`
  - `order=asc|desc`

Example response:

```json
{
  "results": [
    {
      "id": "uuid",
      "participation_id": "uuid",
      "player_name": "Alice",
      "opponent_name": "Bob",
      "pack": "Unicorn",
      "opponent_pack": "Danger",
      "game_version": "67.4",
      "match_type": "ranked",
      "mode": 0,
      "max_player_count": null,
      "active_player_count": null,
      "created_at": "2026-03-01T00:29:00.321Z",
      "tags": ["summit", "tournament:fuji-mini-2"],
      "last_outcome": 1,
      "player_id": "player-1",
      "opponent_id": "player-2",
      "player_rank": 6300,
      "opponent_rank": 6150
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10
}
```

Notes:

- `pid` accepts a UUID, replay URL, or JSON payload containing a participation id
- Hidden players are excluded

### `GET /api/stats`

Returns aggregate stats. This endpoint powers the stats page.

Common query params:

- Pack filters:
  - `pack`
  - `opponentPack`
  - `winningPack`
  - `losingPack`
  - `excludePack`
  - `excludeMirrors=true`
- Player filters:
  - `player`
  - `playerId`
  - `minElo`
  - `maxElo`
- Threshold/range:
  - `minSample` default `10`
  - `minEndOn`
  - `minTurn`
  - `maxTurn`
  - `scope=game|battle`
  - `version`
  - `tags`
- Entity filters:
  - `pet`
  - `petLevel`
  - `perk`
  - `toy`
  - `allyPet`
  - `opponentPet`
  - `allyPerk`
  - `opponentPerk`
  - `allyToy`
  - `opponentToy`

Example response shape:

```json
{
  "totalGames": 250,
  "totalBattles": 3120,
  "generatedAt": "2026-03-13T12:00:00.000Z",
  "newestEntryAt": "2026-03-01T00:29:00.321Z",
  "packStats": [],
  "matchupStats": [],
  "petStats": [],
  "perkStats": [],
  "toyStats": []
}
```

Notes:

- `matchupStats` includes `per_turn` data for each matchup
- Per-turn matchup rows include `wins`, `losses`, `draws`, `winrate`, `lossrate`, `drawrate`, `avg_rolls_per_turn`, `avg_gold_per_turn`
- Arena replays are excluded from stats
- Hidden players are excluded

## Replay Ingest And Replay Detail

### `POST /api/replays`

Ingests one replay.

Request body:

```json
{
  "participationId": "uuid-or-url-or-json-payload"
}
```

Success responses:

```json
{
  "replayId": "uuid",
  "status": "inserted"
}
```

```json
{
  "replayId": "uuid",
  "status": "exists_participation"
}
```

```json
{
  "replayId": "uuid",
  "status": "exists_match"
}
```

Error responses:

- `400`: missing or invalid `participationId`
- `500`: ingest failure

Notes:

- Rate limited
- Also writes turn and pet rows

### `POST /api/replays/bulk`

Bulk ingests many participation ids.

Request body:

```json
{
  "participationIds": ["uuid-1", "uuid-2"]
}
```

Example response:

```json
{
  "inserted": 10,
  "skipped": 4,
  "skippedParticipation": 3,
  "skippedMatch": 1,
  "failed": 0,
  "failedEntries": []
}
```

Notes:

- Rate limited
- Skips replays already present by participation id or match id

### `GET /api/replays/{id}`

Returns replay detail plus rollup stats.

Response shape:

- `replay`: replay row fields, tags, ids, and rank display fields
- `stats`: `turns`, `last_turn`, `last_outcome`, `player_gold_spent`, `opponent_gold_spent`, `player_rolls`, `opponent_rolls`

Notes:

- For private matches, `player_rank_display` and `opponent_rank_display` are inferred from nearby ranked games

### `PATCH /api/replays/{id}`

Replaces the replay tag array.

Request body:

```json
{
  "tags": ["summit", "tournament:fuji-mini-2"]
}
```

Response:

```json
{
  "tags": ["summit", "tournament:fuji-mini-2"]
}
```

Important:

- This route replaces the full tag list for the replay
- It does not append

### `POST /api/replays/{id}`

Alias for replay ingest.

Important:

- `{id}` is treated as a participation id payload and forwarded to `POST /api/replays`
- This route does not ingest by replay row id

### `GET /api/replays/{id}/turns`

Returns expanded replay data for turn-by-turn rendering.

Response keys:

- `replayId`
- `participationId`
- `maxLives`
- `totalTurns`
- `turnCount`
- `turns`
- `genesisBuildModel`
- `genesisModeModel`
- `abilityPetMap`
- `replayMeta`
- `replay`

Each `turns[]` item includes:

- `turn`
- `outcome`
- `user.stats`
- `user.pets`
- `opponent.stats`
- `opponent.pets`

### `GET /api/replays/{id}/image`

Renders a replay summary image.

Response:

- Content type: `image/png`

Errors:

- `400`: missing id
- `404`: replay not found
- `500`: render failure

### `GET /api/replays/{id}/calculator?turn={n}`

Generates a calculator URL for one replay turn.

Required query params:

- `turn`: positive integer

Example response:

```json
{
  "replayId": "uuid",
  "participationId": "uuid",
  "opponentParticipationId": "uuid",
  "turn": 8,
  "maxTurn": 12,
  "url": "https://...",
  "perspectives": {
    "player": "stored",
    "opponent": "fetched",
    "opponentRawAvailable": true
  }
}
```

Errors:

- `400`: invalid or missing `turn`
- `404`: replay not found or no battle actions
- `502`: opponent perspective could not be fetched
- `500`: calculator generation failed

The endpoint resolves the opponent participation id from the stored replay. If
the opponent raw perspective is not already stored, it fetches that PID from
Teamwood and persists it before generating the link. This is required for
custom packs because the primary battle response may not include the opponent's
complete deck.

The response also includes `perspectives.opponent` as `stored` or `fetched` and
`perspectives.opponentRawAvailable` so callers can verify which raw inputs were
used.

### `GET /api/replays/{id}/perspectives`

Returns the raw playback response for the stored participation id and its
opponent participation id. Missing opponent data is fetched and persisted using
the same lazy backfill used by the calculator endpoint.

Example response:

```json
{
  "replayId": "uuid",
  "matchId": "match-uuid",
  "perspectives": [
    {
      "role": "player",
      "participationId": "player-pid",
      "raw": {}
    },
    {
      "role": "opponent",
      "participationId": "opponent-pid",
      "raw": {}
    }
  ]
}
```

Errors:

- `404`: replay not found
- `502`: opponent perspective could not be fetched

## Player Tags

### `GET /api/player-tags`

Supported query modes:

- `playerId=...`: fetch one player tag record
- `tag=...`: list players with a matching tag
- no filters: list recent player tag rows

Optional query params:

- `limit` default `100`, max `500`

Responses:

```json
{
  "player": {
    "player_id": "player-1",
    "tags": ["friendlies", "streamer"],
    "updated_by": "admin",
    "updated_at": "2026-03-01T00:00:00.000Z"
  }
}
```

```json
{
  "players": []
}
```

### `POST /api/player-tags`

Creates or replaces the full tag list for a player.

Request body:

```json
{
  "playerId": "player-1",
  "tags": ["friendlies", "streamer"],
  "updatedBy": "admin"
}
```

### `DELETE /api/player-tags`

Two modes:

- `playerId` only: delete the entire row
- `playerId` plus `tag`: remove one tag from the row

Body and query string are both supported.

## Hidden Players

### `GET /api/hidden-players`

Supported query modes:

- `playerId=...`: check one player
- no filters: list all hidden players

### `POST /api/hidden-players`

Creates or updates a hidden player row.

Request body:

```json
{
  "playerId": "player-1",
  "reason": "requested removal",
  "hiddenBy": "admin"
}
```

Example response:

```json
{
  "hidden": true,
  "player": {
    "player_id": "player-1",
    "reason": "requested removal",
    "hidden_by": "admin",
    "hidden_at": "2026-03-01T00:00:00.000Z"
  }
}
```

### `DELETE /api/hidden-players`

Removes a hidden player row.

Body and query string are both supported.

Response:

```json
{
  "hidden": false,
  "removed": true,
  "playerId": "player-1"
}
```

## Profile And Leaderboards

### `GET /api/profile/players`

Used for player autocomplete/search.

Query params:

- `q` or `query`
- `limit` default `10`, max `50`
- `version`

Example response:

```json
{
  "players": [
    {
      "playerId": "player-1",
      "latestName": "Alice",
      "lastSeenAt": "2026-03-01T00:29:00.321Z",
      "matchedNames": ["Alice", "Alicia"]
    }
  ]
}
```

### `GET /api/leaderboard`

Returns the global player leaderboard.

Query params:

- `scope=game|battle` default `game`
- `search`
- `minMatches`
- `page`
- `pageSize`
- `pack`
- `opponentPack`
- `tags`
- `pet`
- `perk`
- `toy`
- `minTurn`, `maxTurn`
- `sort`
- `order`
- `version`

Response shape:

```json
{
  "scope": "game",
  "page": 1,
  "pageSize": 25,
  "total": 100,
  "players": [
    {
      "playerId": "player-1",
      "playerName": "Alice",
      "games": 120,
      "rounds": 1400,
      "wins": 80,
      "losses": 30,
      "draws": 10,
      "winrate": 0.6667,
      "lossrate": 0.25,
      "drawrate": 0.0833,
      "avgRollsPerTurn": 1.9,
      "avgGoldPerTurn": 8.4,
      "avgElo": 6275,
      "avgSummonsPerTurn": 0.8,
      "avgGameLength": 11.7,
      "mostPlayedPack": "Unicorn"
    }
  ]
}
```

### `GET /api/leaderboard/{playerId}`

Returns one player summary with filters similar to the global leaderboard.

Query params:

- `scope=game|battle`
- `pack`
- `opponentPack`
- `tags`
- `pet`
- `perk`
- `toy`
- `matchType` (repeatable or comma-separated)
- `minTurn`, `maxTurn`
- `startDate`, `endDate`
- `season`
- `lobbyCode`
- `opponentName`
- `version`

Response keys:

- `scope`
- `playerId`
- `playerName`
- `summary`
- `packStats`
- `matchupStats`
- `perTurn`

Notes:

- Returns `404` if the player is hidden

## Top Boards

These endpoints already have a deeper contract doc at [docs/top-boards/api-contract.md](C:/Users/porte/Downloads/sap-replay-bot-main/sap-replay-bot-main/docs/top-boards/api-contract.md).

### `GET /api/boards/runs`

Lists recent top-board ranking runs.

Query params:

- `status=queued|running|complete|failed|canceled`
- `limit` default `20`, max `100`

Response keys:

- `activeRunId`
- `runs[]`

### `POST /api/boards/runs`

Starts a new top-board run.

Query params:

- `sync=true` to wait for synchronous completion

Request body:

```json
{
  "configName": "top-boards.default",
  "createdBy": "api",
  "force": false,
  "configOverride": {}
}
```

Responses:

- `202`: queued async
- `200`: completed sync
- `409`: run already in progress

### `GET /api/boards/runs/{runId}`

Returns one run plus progress counters.

Response keys:

- `run`
- `run.progress.candidateBoards`
- `run.progress.qualifierPairs`
- `run.progress.semifinalPairs`
- `run.progress.finalPairs`
- `run.progress.finalTopN`

### `GET /api/boards/top`

Returns the latest completed board results for a scope.

Query params:

- `version` default `current`
- `matchType` default `ranked`
- `side` default `both`
- `pack`
- `limit` default `100`, max `100`

Response keys:

- `run`
- `total`
- `items`

### `GET /api/boards/top/{runId}`

Same shape as `/api/boards/top`, but pinned to a specific run.

Query params:

- `side`
- `pack`
- `limit`

### `GET /api/boards/top/{runId}/{boardId}`

Returns one board plus its matchup rows.

Query params:

- `limit` default `100`
- `sort` default `opponentRank`
- `order` default `asc`

Response shape:

```json
{
  "runId": "uuid",
  "board": {},
  "matchups": []
}
```

## External Teamwood Endpoints

These are not routes implemented in this repo. They are external Teamwood/Super Auto Pets API endpoints that have been verified during integration work.

Verification date:

- `2026-05-15`

### `POST https://api.teamwood.games/0.{version}/api/user/login`

Used to authenticate against Teamwood.

Request body:

```json
{
  "Email": "user@example.com",
  "Password": "password",
  "Version": "47"
}
```

Observed response keys:

- `Claims`
- `DeviceId`
- `Email`
- `ExpiresOn`
- `Guest`
- `RefreshToken`
- `Token`

Notes:

- Returns a bearer token in `Token`
- Also returns a `RefreshToken`
- Used by [lib/teamwood.js](C:/Users/porte/Downloads/sap-replay-bot-main/sap-replay-bot-main/lib/teamwood.js:64)

### `POST https://api.teamwood.games/0.{version}/api/playback/participation`

Fetches a replay by participation id.

Request headers:

- `Authorization: Bearer <token>`

Request body:

```json
{
  "ParticipationId": "uuid",
  "Turn": 1,
  "Version": "47"
}
```

Notes:

- Requires authenticated access
- Used by [lib/sapPlayback.js](C:/Users/porte/Downloads/sap-replay-bot-main/sap-replay-bot-main/lib/sapPlayback.js:23)

### `GET https://api.teamwood.games/0.{version}/api/history/fetch`

Fetches account history for the authenticated user.

Tested request headers:

- `Authorization: Bearer <token>`
- Optional: `refresh-token: <refresh token>`
- Optional: `device-id: 00000000-0000-0000-0000-000000000000`
- Optional: `language: en`

Observed behavior:

- `200 OK` with bearer token only
- `200 OK` with bearer token plus refresh token
- Response content type: `application/json; charset=utf-8`

Observed response shape:

```json
{
  "History": [],
  "HallFame": []
}
```

Observed non-empty `History[]` item keys:

- `Id`
- `ParticipationId`
- `Version`
- `Mode`
- `Victories`
- `Lives`
- `Battle`
- `CreatedOn`
- `HallFame`

Notes:

- This endpoint is authenticated; it is not a public anonymous history feed
- Replay ingestion can extract top-level `History[].ParticipationId` values and pass them through the normal replay ingest path
- `scripts/sync-history.js` can sync either a live authenticated history response or a saved response file
- No public Swagger/OpenAPI docs were found for Teamwood endpoints during this verification pass

Example local sync commands:

```bash
npm run history:sync -- --dry-run
npm run history:sync -- --file C:\Users\porte\Downloads\response.txt --dry-run
npm run history:sync -- --file C:\Users\porte\Downloads\response.txt
```
