const { fetchParticipationReplay } = require("./sapPlayback");
const { extractReplayIdentities } = require("./parse");

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hasReplayPayload(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getReplayBuildModel(raw) {
  if (!raw || typeof raw !== "object") return null;

  // GenesisBuildModel contains the replay owner's complete deck. Keep the
  // older GenesisModeModel fallback for replays produced by older clients.
  const topLevelModel =
    parseJsonValue(raw.GenesisBuildModel) ||
    parseJsonValue(raw.GenesisModeModel) ||
    null;
  if (topLevelModel) return topLevelModel;

  const actions = Array.isArray(raw.Actions) ? raw.Actions : [];
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action?.Type !== 1 || !action?.Mode) continue;
    const modeModel = parseJsonValue(action.Mode);
    if (modeModel) return modeModel;
  }

  return null;
}

function getOpponentParticipationId(raw, fallback) {
  const extracted = extractReplayIdentities(raw || {}).opponentParticipationId;
  if (extracted) return extracted;

  const modeModel = parseJsonValue(raw?.GenesisModeModel);
  const modeOpponent = modeModel?.Opponents?.[0]?.ParticipationId;
  return (
    (fallback ? String(fallback) : null) ||
    (modeOpponent ? String(modeOpponent) : null) ||
    null
  );
}

/**
 * Return the second player's raw playback perspective, fetching and storing
 * it when a row was created before opponent perspectives were persisted.
 */
async function ensureOpponentReplay(client, row) {
  const raw = parseJsonValue(row?.raw_json);
  const opponentParticipationId = getOpponentParticipationId(
    raw,
    row?.opponent_participation_id
  );
  const storedRaw = parseJsonValue(row?.opponent_raw_json);

  if (hasReplayPayload(storedRaw)) {
    return {
      participationId: opponentParticipationId,
      raw: storedRaw,
      source: "stored"
    };
  }

  if (!opponentParticipationId || opponentParticipationId === row?.participation_id) {
    return {
      participationId: opponentParticipationId,
      raw: null,
      source: null
    };
  }

  const opponentRaw = await fetchParticipationReplay(opponentParticipationId);

  if (client && row?.id) {
    await client.query(
      `update replays
       set opponent_raw_json = $1,
           opponent_participation_id = coalesce(opponent_participation_id, $2)
       where id = $3
         and opponent_raw_json is null`,
      [opponentRaw, opponentParticipationId, row.id]
    );
  }

  return {
    participationId: opponentParticipationId,
    raw: opponentRaw,
    source: "fetched"
  };
}

async function persistOpponentReplay(
  client,
  {
    replayId,
    existingParticipationId,
    participationId,
    currentRaw,
    opponentRaw,
    opponentParticipationId
  }
) {
  const rawToStore =
    String(existingParticipationId || "") === String(participationId || "")
      ? opponentRaw
      : currentRaw;
  if (!rawToStore || !replayId) return false;

  const storedParticipationId =
    String(existingParticipationId || "") === String(participationId || "")
      ? opponentParticipationId
      : participationId;

  await client.query(
    `update replays
     set opponent_raw_json = coalesce(opponent_raw_json, $1),
         opponent_participation_id = coalesce(opponent_participation_id, $2)
     where id = $3`,
    [rawToStore, storedParticipationId || null, replayId]
  );
  return true;
}

module.exports = {
  ensureOpponentReplay,
  getOpponentParticipationId,
  getReplayBuildModel,
  hasReplayPayload,
  parseJsonValue,
  persistOpponentReplay
};
