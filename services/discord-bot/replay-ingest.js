const { Pool } = require("pg");
const { parseReplay } = require("../../lib/parse");
const { insertActions } = require("../../lib/actions");
const { fetchParticipationReplay } = require("../../lib/sapPlayback");
const { persistOpponentReplay } = require("../../lib/replayPerspectives");
const { registerReplayInsertAndMaybeStartTopBoards } = require("../../lib/topBoardsAutoRun");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function extractParticipationId(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text) return null;

  // Accept any UUID version/variant. SAP v48 switched participation IDs to
  // UUIDv7 (version nibble 7, variant outside [89ab]), so the old RFC-4122
  // restricted pattern rejected every new replay.
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      const fromJson =
        parsed?.Pid ||
        parsed?.pid ||
        parsed?.ParticipationId ||
        parsed?.participationId;
      if (fromJson && uuidRegex.test(String(fromJson))) {
        return String(fromJson).match(uuidRegex)[0];
      }
    } catch {
      // Continue to URL/regex matching.
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const candidates = [
        url.searchParams.get("Pid"),
        url.searchParams.get("pid"),
        url.searchParams.get("ParticipationId"),
        url.searchParams.get("participationId"),
        url.searchParams.get("participation_id")
      ].filter(Boolean);

      for (const candidate of candidates) {
        const match = String(candidate).match(uuidRegex);
        if (match) return match[0];
      }

      const hashMatch = decodeURIComponent(url.hash || "").match(uuidRegex);
      if (hashMatch) return hashMatch[0];
    } catch {
      // Continue to regex matching.
    }
  }

  const keyedMatch = text.match(
    /(?:^|[?&#])(?:pid|Pid|participationId|ParticipationId|participation_id)=([0-9a-f-]{36})/i
  );
  if (keyedMatch) return keyedMatch[1];

  const plainMatch = text.match(uuidRegex);
  if (plainMatch) return plainMatch[0];

  return null;
}

function isFiniteRank(value) {
  return Number.isFinite(value) ? value : null;
}

function sanitizeRanksForMatchType(parsed) {
  if (String(parsed?.matchType || "").toLowerCase() !== "private") {
    return parsed;
  }
  return {
    ...parsed,
    playerRank: null,
    opponentRank: null
  };
}

function pickBestRankPair(primaryPlayerRank, primaryOpponentRank, mirroredPlayerRank, mirroredOpponentRank) {
  const primaryDistinct =
    primaryPlayerRank !== null &&
    primaryOpponentRank !== null &&
    primaryPlayerRank !== primaryOpponentRank;
  const mirroredDistinct =
    mirroredPlayerRank !== null &&
    mirroredOpponentRank !== null &&
    mirroredPlayerRank !== mirroredOpponentRank;

  if (!primaryDistinct && mirroredDistinct) {
    return {
      playerRank: mirroredPlayerRank,
      opponentRank: mirroredOpponentRank
    };
  }

  if (primaryDistinct && !mirroredDistinct) {
    return {
      playerRank: primaryPlayerRank,
      opponentRank: primaryOpponentRank
    };
  }

  return {
    playerRank: primaryPlayerRank ?? mirroredPlayerRank,
    opponentRank: primaryOpponentRank ?? mirroredOpponentRank
  };
}

async function enrichReplayWithOpponentRank(raw, parsed, participationId) {
  const primaryPlayerRank = isFiniteRank(parsed.playerRank);
  const primaryOpponentRank = isFiniteRank(parsed.opponentRank);
  let playerRank = primaryPlayerRank;
  let opponentRank = primaryOpponentRank;
  let opponentId = parsed.opponentId || null;
  let opponentParticipationId = parsed.opponentParticipationId || null;
  let opponentRaw = null;

  if (opponentParticipationId && opponentParticipationId !== participationId) {
    try {
      opponentRaw = await fetchParticipationReplay(opponentParticipationId);
      const opponentParsed = parseReplay(opponentRaw);
      opponentId = opponentParsed.playerId || opponentId;
      const opponentSidePlayerRank = isFiniteRank(opponentParsed.playerRank);
      const opponentSideOpponentRank = isFiniteRank(opponentParsed.opponentRank);
      const selected = pickBestRankPair(
        primaryPlayerRank,
        primaryOpponentRank,
        opponentSideOpponentRank,
        opponentSidePlayerRank
      );
      playerRank = selected.playerRank;
      opponentRank = selected.opponentRank;
    } catch (error) {
      console.warn("Opponent replay fetch failed during rank enrichment", {
        participationId,
        opponentParticipationId,
        error: error?.message || "failed"
      });
    }
  }

  return {
    raw,
    opponentRaw,
    parsed: {
      ...parsed,
      playerRank,
      opponentRank,
      opponentId,
      opponentParticipationId
    }
  };
}

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

async function ingestParticipationReplay(rawParticipationId) {
  const participationId = extractParticipationId(rawParticipationId);
  if (!participationId) {
    return { status: "invalid_participation_id" };
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "select id, match_id from replays where participation_id = $1 limit 1",
      [participationId]
    );
    if (existing.rowCount) {
      return {
        status: "exists_participation",
        replayId: existing.rows[0].id,
        participationId,
        matchId: existing.rows[0].match_id || null
      };
    }

    const raw = await fetchParticipationReplay(participationId);
    const parsed = parseReplay(raw);
    const enriched = await enrichReplayWithOpponentRank(raw, parsed, participationId);
    const finalRaw = enriched.raw;
    const finalParsed = sanitizeRanksForMatchType(enriched.parsed);
    const normalizedMatchId =
      (finalParsed.matchType || "").toLowerCase() === "arena" ? null : finalParsed.matchId;

    if (normalizedMatchId) {
      const existingMatch = await client.query(
        "select id, participation_id from replays where match_id = $1 limit 1",
        [normalizedMatchId]
      );
      if (existingMatch.rowCount) {
        await persistOpponentReplay(client, {
          replayId: existingMatch.rows[0].id,
          existingParticipationId: existingMatch.rows[0].participation_id,
          participationId,
          currentRaw: finalRaw,
          opponentRaw: enriched.opponentRaw,
          opponentParticipationId: finalParsed.opponentParticipationId
        });
        return {
          status: "exists_match",
          replayId: existingMatch.rows[0].id,
          participationId,
          matchId: normalizedMatchId
        };
      }
    }

    const replayRes = await client.query(
      `insert into replays (
         participation_id,
         match_id,
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
         opponent_raw_json,
         player_rank,
         opponent_rank,
         raw_json
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       on conflict do nothing
       returning id`,
      [
        participationId,
        normalizedMatchId,
        finalParsed.playerName,
        finalParsed.opponentName,
        finalParsed.packName,
        finalParsed.opponentPackName,
        finalParsed.gameVersion,
        finalParsed.maxLives,
        finalParsed.mode,
        finalParsed.matchType,
        finalParsed.matchName,
        finalParsed.matchPack,
        finalParsed.maxPlayerCount,
        finalParsed.activePlayerCount,
        finalParsed.spectatorMode,
        finalParsed.playerId,
        finalParsed.opponentId,
        finalParsed.opponentParticipationId,
        enriched.opponentRaw,
        finalParsed.playerRank,
        finalParsed.opponentRank,
        finalRaw
      ]
    );

    let replayId = replayRes.rows[0]?.id;
    if (!replayId) {
      const existingByPid = await client.query(
        "select id from replays where participation_id = $1 limit 1",
        [participationId]
      );
      if (existingByPid.rowCount) {
        return {
          status: "exists_participation",
          replayId: existingByPid.rows[0].id,
          participationId,
          matchId: normalizedMatchId || null
        };
      }

      if (normalizedMatchId) {
        const existingByMatch = await client.query(
          "select id, participation_id from replays where match_id = $1 limit 1",
          [normalizedMatchId]
        );
        if (existingByMatch.rowCount) {
          await persistOpponentReplay(client, {
            replayId: existingByMatch.rows[0].id,
            existingParticipationId: existingByMatch.rows[0].participation_id,
            participationId,
            currentRaw: finalRaw,
            opponentRaw: enriched.opponentRaw,
            opponentParticipationId: finalParsed.opponentParticipationId
          });
          return {
            status: "exists_match",
            replayId: existingByMatch.rows[0].id,
            participationId,
            matchId: normalizedMatchId
          };
        }
      }
      throw new Error("failed to insert replay");
    }

    if (finalParsed.turns.length > 0) {
      const turnPlaceholders = finalParsed.turns.map((_, i) => {
        const o = i * 11;
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11})`;
      }).join(",");
      await client.query(
        `insert into turns (replay_id,turn_number,outcome,opponent_name,player_lives,player_gold_spent,opponent_gold_spent,player_rolls,opponent_rolls,player_summons,opponent_summons) values ${turnPlaceholders}`,
        finalParsed.turns.flatMap(turn => [
          replayId, turn.turn_number, turn.outcome, turn.opponent_name,
          turn.player_lives, turn.player_gold_spent, turn.opponent_gold_spent,
          turn.player_rolls, turn.opponent_rolls, turn.player_summons, turn.opponent_summons
        ])
      );
    }

    if (finalParsed.pets.length > 0) {
      const petPlaceholders = finalParsed.pets.map((_, i) => {
        const o = i * 10;
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10})`;
      }).join(",");
      await client.query(
        `insert into pets (replay_id,turn_number,side,position,pet_name,level,attack,health,perk,toy) values ${petPlaceholders}`,
        finalParsed.pets.flatMap(pet => [
          replayId, pet.turn_number, pet.side, pet.position,
          pet.pet_name, pet.level, pet.attack, pet.health, pet.perk, pet.toy
        ])
      );
    }

    await insertActions(client, replayId, finalParsed.actions);

    try {
      const autoRun = await registerReplayInsertAndMaybeStartTopBoards({
        db: pool,
        source: "discord.replay_ingest",
        matchType: finalParsed.matchType,
        incrementBy: 1,
        replayCreatedAt: new Date().toISOString(),
        logger: console
      });
      if (autoRun?.triggered) {
        console.log("Top boards autorun queued from discord replay ingest", {
          runId: autoRun.runId,
          pendingReplays: autoRun.pendingReplays
        });
      }
    } catch (autoRunError) {
      console.warn("Top boards autorun check failed after discord replay insert", {
        replayId,
        error: autoRunError?.message || autoRunError
      });
    }

    return { status: "inserted", replayId, participationId, matchId: normalizedMatchId || null };
  } finally {
    client.release();
  }
}

async function appendReplayTags(replayId, tags, options = {}) {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return { tags: [] };
  }

  const replayIdText = replayId ? String(replayId) : null;
  const participationId = options.participationId ? String(options.participationId) : null;
  const matchId = options.matchId ? String(options.matchId) : null;

  const client = await pool.connect();
  try {
    const res = await client.query(
      `update replays r
       set tags = (
         select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
         from unnest(coalesce(r.tags, '{}'::text[]) || $1::text[]) as tag
       )
       where (
         ($2::text is not null and r.id::text = $2::text)
         or ($3::text is not null and r.participation_id = $3::text)
         or ($4::text is not null and r.match_id = $4::text)
       )
       returning r.id, r.tags`,
      [normalized, replayIdText, participationId, matchId]
    );
    if (!res.rowCount) {
      return { tags: [], updated: false };
    }
    return { replayId: res.rows[0].id || replayIdText, tags: res.rows[0].tags || [], updated: true };
  } finally {
    client.release();
  }
}

module.exports = {
  ingestParticipationReplay,
  appendReplayTags,
  normalizeTags,
  extractParticipationId
};
