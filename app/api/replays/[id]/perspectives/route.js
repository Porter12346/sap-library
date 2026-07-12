import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

const { ensureOpponentReplay } = require("@/lib/replayPerspectives");

export const runtime = "nodejs";

export async function GET(_req, context) {
  const params = await context?.params;
  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `select id,
              match_id,
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

    let opponentPerspective;
    try {
      opponentPerspective = await ensureOpponentReplay(client, rows[0]);
    } catch (error) {
      console.error("Failed to fetch opponent replay perspective", {
        id,
        error: error?.message || error
      });
      return NextResponse.json(
        { error: "opponent replay perspective unavailable" },
        { status: 502 }
      );
    }

    const perspectives = [
      {
        role: "player",
        participationId: rows[0].participation_id,
        raw: rows[0].raw_json
      }
    ];

    if (opponentPerspective.participationId || opponentPerspective.raw) {
      perspectives.push({
        role: "opponent",
        participationId: opponentPerspective.participationId,
        raw: opponentPerspective.raw
      });
    }

    return NextResponse.json({
      replayId: rows[0].id,
      matchId: rows[0].match_id,
      perspectives
    });
  } finally {
    client.release();
  }
}
