import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { POST as ingestReplayPost } from "../route";

export const runtime = "nodejs";

function normalizeTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

async function findClosestRankForPlayer(client, playerId, replayCreatedAt) {
  if (!playerId || !replayCreatedAt) return null;

  const { rows } = await client.query(
    `
      with ranked_rows as (
        select
          coalesce(
            r.player_rank,
            case
              when ((nullif(r.raw_json->>'GenesisModeModel', '')::jsonb->>'Rank') ~ '^[0-9]+$')
                then (nullif(r.raw_json->>'GenesisModeModel', '')::jsonb->>'Rank')::int
              else null
            end
          ) as rank,
          r.created_at
        from replays r
        where lower(coalesce(r.match_type, '')) = 'ranked'
          and r.player_id = $1

        union all

        select
          coalesce(
            r.opponent_rank,
            case
              when ((nullif(r.raw_json->>'GenesisModeModel', '')::jsonb->'Opponents'->0->>'Rank') ~ '^[0-9]+$')
                then (nullif(r.raw_json->>'GenesisModeModel', '')::jsonb->'Opponents'->0->>'Rank')::int
              else null
            end
          ) as rank,
          r.created_at
        from replays r
        where lower(coalesce(r.match_type, '')) = 'ranked'
          and r.opponent_id = $1
      )
      select rank
      from ranked_rows
      where rank is not null
      order by abs(extract(epoch from (created_at - $2::timestamptz))) asc, created_at desc
      limit 1
    `,
    [playerId, replayCreatedAt]
  );

  return Number.isFinite(rows[0]?.rank) ? rows[0].rank : null;
}

export async function GET(_req, context) {
  const params = await context?.params;
  const { id } = params || {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const replayRes = await client.query(
      `select
         id,
         participation_id,
         player_name,
         opponent_name,
         pack,
         opponent_pack,
         game_version,
         max_lives,
         mode,
         match_type,
         match_name,
         match_pack,
         max_player_count,
         active_player_count,
         spectator_mode,
         player_id,
         opponent_id,
         opponent_participation_id,
         (opponent_raw_json is not null) as opponent_replay_available,
         player_rank,
         opponent_rank,
         tags,
         created_at,
         raw_json
       from replays
       where id=$1`,
      [id]
    );

    if (!replayRes.rowCount) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const statsRes = await client.query(
      `select
         count(*)::int as turns,
         max(turn_number)::int as last_turn,
         (select outcome from turns where replay_id=$1 order by turn_number desc limit 1) as last_outcome,
         coalesce(sum(player_gold_spent), 0)::int as player_gold_spent,
         coalesce(sum(opponent_gold_spent), 0)::int as opponent_gold_spent,
         coalesce(sum(player_rolls), 0)::int as player_rolls,
         coalesce(sum(opponent_rolls), 0)::int as opponent_rolls
       from turns
       where replay_id=$1`,
      [id]
    );

    const isPrivate = String(replayRes.rows[0].match_type || "").toLowerCase() === "private";
    let playerId = replayRes.rows[0].player_id || null;
    let opponentId = replayRes.rows[0].opponent_id || null;
    let opponentParticipationId = replayRes.rows[0].opponent_participation_id || null;
    let playerRank = isPrivate
      ? null
      : Number.isFinite(replayRes.rows[0].player_rank)
        ? replayRes.rows[0].player_rank
        : null;
    let opponentRank = isPrivate
      ? null
      : Number.isFinite(replayRes.rows[0].opponent_rank)
        ? replayRes.rows[0].opponent_rank
        : null;
    try {
      const raw = replayRes.rows[0].raw_json;
      playerId = playerId || raw?.UserId || null;
      try {
        const modeModel = raw?.GenesisModeModel ? JSON.parse(raw.GenesisModeModel) : null;
        opponentId = opponentId || modeModel?.Opponents?.[0]?.UserId || null;
        opponentParticipationId = opponentParticipationId || modeModel?.Opponents?.[0]?.ParticipationId || null;
        if (!isPrivate) {
          const parsedPlayerRank = modeModel?.Rank;
          const parsedOpponentRank = modeModel?.Opponents?.[0]?.Rank;
          if (playerRank === null) {
            playerRank = Number.isFinite(parsedPlayerRank) ? parsedPlayerRank : null;
          }
          if (opponentRank === null) {
            opponentRank = Number.isFinite(parsedOpponentRank) ? parsedOpponentRank : null;
          }
        }
      } catch {
        // ignore
      }
      const actions = raw?.Actions || [];
      const battles = actions
        .filter((a) => a.Type === 0)
        .map((a) => JSON.parse(a.Battle));
      if (!isPrivate && (playerRank === null || opponentRank === null)) {
        for (let i = actions.length - 1; i >= 0; i -= 1) {
          const action = actions[i];
          if (action?.Type !== 1 || !action?.Mode) continue;
          try {
            const mode = typeof action.Mode === "string" ? JSON.parse(action.Mode) : action.Mode;
            if (playerRank === null && Number.isFinite(mode?.Rank)) {
              playerRank = mode.Rank;
            }
            if (opponentRank === null && Number.isFinite(mode?.Opponents?.[0]?.Rank)) {
              opponentRank = mode.Opponents[0].Rank;
            }
            if (playerRank !== null && opponentRank !== null) break;
          } catch {
            // ignore
          }
        }
      }
      if (!opponentId) {
        opponentId = battles?.[0]?.Opponent?.Id || null;
      }
    } catch {
      // ignore
    }

    let playerRankDisplay = playerRank;
    let opponentRankDisplay = opponentRank;
    if (isPrivate) {
      playerRankDisplay = await findClosestRankForPlayer(client, playerId, replayRes.rows[0].created_at);
      opponentRankDisplay = await findClosestRankForPlayer(client, opponentId, replayRes.rows[0].created_at);
    }

    return NextResponse.json({
      replay: {
        ...replayRes.rows[0],
        player_id: playerId,
        opponent_id: opponentId,
        opponent_participation_id: opponentParticipationId,
        player_rank: playerRank,
        opponent_rank: opponentRank,
        player_rank_display: playerRankDisplay,
        opponent_rank_display: opponentRankDisplay,
        raw_json: undefined
      },
      stats: {
        ...(statsRes.rows[0] || { turns: 0, last_turn: null, last_outcome: null })
      }
    });
  } finally {
    client.release();
  }
}

export async function PATCH(req, context) {
  const params = await context?.params;
  const { id } = params || {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const tags = normalizeTags(body?.tags);

  const client = await pool.connect();
  try {
    const updateRes = await client.query(
      `update replays set tags=$1 where id=$2 returning tags`,
      [tags, id]
    );
    if (!updateRes.rowCount) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ tags: updateRes.rows[0].tags || [] });
  } finally {
    client.release();
  }
}

export async function POST(req, context) {
  const params = await context?.params;
  const { id } = params || {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const forwardReq = new Request(new URL("/api/replays", req.url), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ participationId: decodeURIComponent(id) })
  });

  return ingestReplayPost(forwardReq);
}


