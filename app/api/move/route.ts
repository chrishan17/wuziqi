import { appendFileSync, mkdirSync } from "node:fs";
import { NextResponse } from "next/server";
import { type Board, type Player, DEFAULT_SIZE, applyMove, emptyCells } from "@/lib/board";
import { nakedJevMove, PRIORITY, PRIORITY_INITIATIVE, type HistoryEntry } from "@/lib/jev";
import { activeTransport, describeMissingKey, transportWarnings } from "@/lib/transport";
import { enumerateThreats } from "@/lib/lines";
import { FREESTYLE, outcomeOf, type Rules } from "@/lib/renju";

/**
 * Append every UI move so a human game can be reviewed afterwards.
 * Local only — Vercel's filesystem is read-only, so this is skipped there
 * rather than throwing on every request.
 */
function logMove(record: Record<string, unknown>) {
  if (process.env.VERCEL) return;
  try {
    mkdirSync("runs", { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(`runs/ui-${day}.jsonl`, JSON.stringify({ ts: Date.now(), ...record }) + "\n");
  } catch {
    // logging must never break a game
  }
}

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { board?: Board; history?: HistoryEntry[]; jev?: Player; rules?: Rules };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const size = DEFAULT_SIZE;
  const board = body.board;
  const jev = (body.jev ?? 2) as Player;
  const history = body.history ?? [];

  if (!Array.isArray(board) || board.length !== size * size) {
    return NextResponse.json({ error: `board must be an array of ${size * size} cells.` }, { status: 400 });
  }
  if (emptyCells(board).length === 0) {
    return NextResponse.json({ error: "The board is full." }, { status: 400 });
  }

  for (const w of transportWarnings()) console.warn(`transport warning: ${w}`);
  const missingKey = describeMissingKey(activeTransport());
  if (missingKey) {
    return NextResponse.json({ error: missingKey }, { status: 500 });
  }

  try {
    // Always informed. The naked convention exists only as a measurement
    // baseline in scripts/ — it scored 0/12 on forced moves and is not a
    // playable opponent. See RESULTS.md.
    const rules: Rules = body.rules ?? FREESTYLE;
    // The priority ladder follows the seat. `PRIORITY` puts three blocks above
    // the player's own offence and ends with "defence beats offence" — correct
    // for white, who reacts, and wrong for black, who opens. See RESULTS.md:
    // even against L2, black with the initiative ladder is 8-0 in 18.3 plies vs
    // 8-0 in 20.8, and builds stronger shapes at every phase.
    const priority = jev === 1 ? PRIORITY_INITIATIVE : PRIORITY;
    const trace = await nakedJevMove({ board, size, jev, history, informed: true, rules, priority });
    // `isWinningMove` is free-style: it calls six-in-a-row a win. That is right
    // for white and wrong for black under 长连, and Jev can now play black —
    // so judge Jev's move by the same referee that judges the human's.
    const verdict = outcomeOf(board, size, trace.moveIdx, jev, rules);
    const won = verdict.kind === "win";
    const forbidden = verdict.kind === "forbidden" ? verdict.rule : null;
    logMove({
      // Jev can hold either colour now; without this the log cannot say which
      // seat it played, and every per-colour analysis is guesswork.
      jev,
      seat: jev === 1 ? "black" : "white",
      optionCount: trace.optionCount,
      rules,
      history,
      jevMove: trace.move,
      won,
      ...(forbidden ? { forbidden } : {}),
      // what Jev was shown, and what it was facing
      threatsBefore: enumerateThreats(board, size, 3),
      topMoves: trace.topMoves,
      position: trace.position,
      latencyMs: trace.latencyMs,
    });
    return NextResponse.json({ trace, won, forbidden });
  } catch (err: any) {
    console.error("jev move failed", err);
    return NextResponse.json(
      { error: err?.message ?? "Jev request failed.", name: err?.name ?? "Error" },
      { status: 502 },
    );
  }
}
