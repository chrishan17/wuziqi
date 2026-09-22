import { appendFileSync, mkdirSync } from "node:fs";
import { NextResponse } from "next/server";
import { type Board, type Player, DEFAULT_SIZE, applyMove, emptyCells } from "@/lib/board";
import { nakedJevMove, PRIORITY_KEY_LEAVES, PRIORITY_LEAN_WHITE, type HistoryEntry } from "@/lib/jev";
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
  let body: { board?: Board; history?: HistoryEntry[]; jev?: Player; rules?: Rules; brief?: boolean };
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
    // 详注 is the informed convention. 素盘 (`brief`) sends only the game, the
    // colour, the board, and whether 禁手 is on — no lines, no point effects,
    // no priority. The page switches between them. Naked (neither) stays a
    // measurement baseline in scripts/: 0/12 on forced moves.
    const rules: Rules = body.rules ?? FREESTYLE;
    const brief = body.brief === true;
    // The priority ladder follows the seat. Black attacks, so a four of its own
    // stays above blocking an open three. An open three the opponent already
    // has is blocked before black makes one of its own — otherwise they turn
    // theirs into an open four. White answers first. Both ladders keep a
    // diagonal step that is only a two below an open three; when several open
    // threes exist, the diagonal one comes first. 素盘 sends neither ladder.
    // Black: PRIORITY_KEY, which drops "make a four, play it" and gives
    // `double_threat` / `white_would_make` a rung, paired with `keyPoints`.
    // 20 games vs L3 on seeds 51000+: 15-5 vs 13-7, plain fours 32% -> 22%,
    // `white_would_make` point taken 15% -> 56%. White is unchanged.
    // Then `leaves` (what a block of an open three still lets them make) with
    // PRIORITY_KEY_LEAVES: the clean block taken 30/32 vs 20/31, 15-4-1 vs 12-7-1.
    // Then no `blocks_*` for blocked threes — a removal: the commonest lure away
    // from `white_would_make` (real misses 5 -> 3), 13-7 vs 14-6, within noise.
    const priority = jev === 1 ? PRIORITY_KEY_LEAVES : PRIORITY_LEAN_WHITE;
    // `double_threat` in `point_effects`: 四三 / 双三 stated as one fact, instead
    // of the point collapsing to its single strongest shape. The field is
    // computed for the seat Jev holds, so as white it describes white's own
    // shapes, not black's. Measured +8.2pp over 680 games for BLACK only
    // (pooled McNemar p = 0.014; believe the replication's +5.3pp). White is
    // unmeasured — enabled because it was asked for, not because it was shown.
    // Always pass an explicit mode: `true` means "fixed", which went 4-8 paired
    // against "legacy" over 40 seeds. "split" keeps legacy's points and order
    // with honest names (15-5 vs 11-9 on 20 seeds, p = 0.125). See RESULTS.md.
    // 素盘 does not send `point_effects` at all.
    const trace = await nakedJevMove(
      brief
        ? { board, size, jev, history, rules, brief: true }
        : { board, size, jev, history, informed: true, rules, priority, doubleThreat: "split", leanDiagonal: true, keyPoints: jev === 1, blockLeaves: jev === 1, dropBlockedThreeBlocks: jev === 1 },
    );
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
      brief,
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
