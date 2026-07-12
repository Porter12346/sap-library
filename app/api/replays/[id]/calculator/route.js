import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
const { parseReplayForCalculator, generateCalculatorLink } = require("@/lib/calculator");
const {
  ensureOpponentReplay,
  getReplayBuildModel,
  parseJsonValue
} = require("@/lib/replayPerspectives");

export const runtime = "nodejs";

function parseBattle(action) {
  if (!action || action.Type !== 0 || !action.Battle) {
    return null;
  }
  return parseJsonValue(action.Battle);
}

export async function GET(req, context) {
  const params = await context?.params;
  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const requestUrl = new URL(req.url);
  const turn = Number.parseInt(requestUrl.searchParams.get("turn") || "", 10);
  if (!Number.isFinite(turn) || turn < 1) {
    return NextResponse.json({ error: "turn must be a positive integer" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `select id,
              participation_id,
              opponent_participation_id,
              raw_json,
              opponent_raw_json
       from replays
       where id = $1`,
      [id]
    );

    if (!rows.length) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const replayRow = rows[0];
    const replay = parseJsonValue(replayRow.raw_json);
    const actions = Array.isArray(replay?.Actions) ? replay.Actions : [];
    const abilitySources = actions
      .flatMap((action) => [action?.Build, action?.Battle, action?.Mode])
      .map(parseJsonValue)
      .filter(Boolean);
    const battles = actions.map(parseBattle).filter(Boolean);

    if (!battles.length) {
      return NextResponse.json({ error: "no battles found in replay" }, { status: 404 });
    }

    if (turn > battles.length) {
      return NextResponse.json(
        { error: `turn ${turn} not found`, maxTurn: battles.length },
        { status: 400 }
      );
    }

    let opponentPerspective;
    try {
      opponentPerspective = await ensureOpponentReplay(client, replayRow);
    } catch (error) {
      console.error("Failed to fetch opponent replay perspective", {
        id,
        participationId: replayRow.participation_id,
        opponentParticipationId: replayRow.opponent_participation_id,
        error: error?.message || error
      });
      return NextResponse.json(
        { error: "opponent replay perspective unavailable" },
        { status: 502 }
      );
    }

    const buildModel = getReplayBuildModel(replay);
    const opponentBuildModel = getReplayBuildModel(opponentPerspective.raw);
    const calculatorState = parseReplayForCalculator(
      battles[turn - 1],
      buildModel,
      opponentBuildModel ? [opponentBuildModel] : [],
      { abilitySources }
    );
    const url = generateCalculatorLink(calculatorState);

    if (!url || typeof url !== "string") {
      throw new Error("calculator link generation returned an invalid value");
    }

    return NextResponse.json({
      replayId: replayRow.id,
      participationId: replayRow.participation_id,
      opponentParticipationId: opponentPerspective.participationId,
      turn,
      maxTurn: battles.length,
      url,
      perspectives: {
        player: "stored",
        opponent: opponentPerspective.source,
        opponentRawAvailable: Boolean(opponentPerspective.raw)
      }
    });
  } catch (error) {
    console.error("Failed to generate calculator link", {
      id,
      turn,
      error: error?.message || error,
      stack: error?.stack || null
    });
    return NextResponse.json({ error: "failed to generate calculator link" }, { status: 500 });
  } finally {
    client.release();
  }
}
