/**
 * Whole-game diagonal lean vs the shipped 详注 request, black vs L3.
 *
 *   npx tsx scripts/test-lean.ts --facts
 *   npx tsx --env-file-if-exists=.env.local scripts/test-lean.ts
 *
 * Ten games: five seeds, each played as the old 详注 ladder and as the shipped
 * one. The control is PRIORITY_INITIATIVE + double_threat. The lean arm is
 * PRIORITY_LEAN + direction on each point_effects phrase + diagonal_branches.
 * An open three stays above the branch. Seeds 14000–14004 measured the previous
 * text, which put the branch above the open three; do not reuse them.
 *
 * `--facts` checks the point lists and does not call Jev.
 */
import {
  type Board, type Player,
  applyMove, createBoard, emptyCells, fromLabel, isWinningMove, toLabel,
} from "../lib/board";
import { diagonalBranches } from "../lib/lines";
import { makeRng, opponentMove } from "../lib/opponent";
import { buildState, nakedJevMove, PRIORITY_INITIATIVE, PRIORITY_LEAN } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const SIZE = 15;
const JEV: Player = 1;
const OPP: Player = 2;
const SEEDS = [15000, 15001, 15002, 15003, 15004];

function put(board: Board, label: string, p: Player) {
  board[fromLabel(label, SIZE)] = p;
}

function pointsOf(board: Board, p: Player) {
  const b = diagonalBranches(board, SIZE, p);
  return b?.points.map((x) => x.point) ?? [];
}

function facts() {
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, extra = "") => {
    if (cond) { pass++; console.log(`  PASS ${name}`); }
    else { fail++; console.log(`  FAIL ${name} ${extra}`); }
  };
  const has = (xs: string[], label: string) => xs.includes(label);

  let b = createBoard(SIZE);
  ok("empty board emits nothing", diagonalBranches(b, SIZE, 1) === null);

  b = createBoard(SIZE);
  put(b, "H8", 1);
  let one = pointsOf(b, 1);
  ok("one stone lists its diagonal neighbours", ["G7", "I7", "G9", "I9"].every((l) => has(one, l)), one.join(" "));
  ok("one stone omits orthogonal neighbours", !["H7", "H9", "G8", "I8"].some((l) => has(one, l)), one.join(" "));

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I7", 2);
  one = pointsOf(b, 1);
  ok("occupied diagonal is dropped", ["G7", "G9", "I9"].every((l) => has(one, l)) && !has(one, "I7") && !has(one, "H7"), one.join(" "));

  b = createBoard(SIZE);
  put(b, "H8", 1);
  one = pointsOf(b, 2);
  ok("reply to one stone is diagonal", ["G7", "I7", "G9", "I9"].every((l) => has(one, l)) && !has(one, "H7"), one.join(" "));

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1);
  const pair = pointsOf(b, 1);
  ok("horizontal pair lists outward diagonals", ["G7", "G9", "J7", "J9"].every((l) => has(pair, l)), pair.join(" "));
  ok("shoulders and straight ends are absent", !["I7", "H7", "G8", "J8", "H9", "I9"].some((l) => has(pair, l)), pair.join(" "));

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1); put(b, "G7", 1);
  ok("diagonal pair emits nothing", diagonalBranches(b, SIZE, 1) === null);

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1); put(b, "J8", 1);
  ok("straight three can make a four, so no branches", diagonalBranches(b, SIZE, 1) === null);

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1);
  const st = buildState(b, SIZE, 1, [], true, undefined, false, false, true, false, false, false, true) as {
    point_effects: Array<{ point: string; for_black?: string }>;
    diagonal_branches?: Array<{ point: string }>;
  };
  const j8 = st.point_effects.find((e) => e.point === "J8");
  ok("open three names its direction", j8?.for_black === "makes an open three (horizontal)", j8?.for_black ?? "missing");
  ok("branches ride along in the state", (st.diagonal_branches?.length ?? 0) > 0);

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1); put(b, "G7", 1); put(b, "H7", 2);
  const st2 = buildState(b, SIZE, 1, [], true, undefined, false, false, true, false, false, false, true) as {
    point_effects: Array<{ point: string; for_black?: string }>;
    diagonal_branches?: unknown;
  };
  const diag = st2.point_effects.find((e) => e.for_black?.includes("diagonal"));
  ok("a diagonal open three is labelled", !!diag, diag?.for_black ?? "none");
  ok("branches gone once a diagonal exists", st2.diagonal_branches === undefined);

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I7", 1); put(b, "G7", 2); put(b, "G9", 2);
  const st3 = buildState(b, SIZE, 1, [], true, undefined, false, false, true, false, false, false, true) as {
    point_effects: Array<{ point: string; for_black?: string }>;
  };
  const k5 = st3.point_effects.find((e) => e.point === "K5");
  const j6 = st3.point_effects.find((e) => e.point === "J6");
  ok("jump past a blocked end is not an open three", k5?.for_black === "makes a blocked three (diagonal up-right)", k5?.for_black ?? "missing");
  ok("adjacent extension is listed before the jump", st3.point_effects.findIndex((e) => e.point === "J6") < st3.point_effects.findIndex((e) => e.point === "K5"),
    st3.point_effects.map((e) => e.point).join(" "));
  ok("adjacent extension is a blocked three", j6?.for_black?.startsWith("makes a blocked three") ?? false, j6?.for_black ?? "missing");

  b = createBoard(SIZE);
  for (const [l, p] of [["H8", 1], ["G9", 2], ["G7", 1], ["F8", 2], ["F6", 1], ["I9", 2], ["E5", 1], ["D4", 2]] as const) put(b, l, p as 1 | 2);
  const capped = diagonalBranches(b, SIZE, 1);
  const cappedPts = capped?.points.map((x) => x.point) ?? [];
  ok("capped diagonal lists the other diagonal", cappedPts.length > 0 && !cappedPts.includes("H9"), cappedPts.join(" "));
  const st4 = buildState(b, SIZE, 1, [], true, undefined, false, false, true, false, false, false, true) as {
    lines_on_board: Array<{ stones: string[]; note: string; critical_points: string[] }>;
  };
  const dead = st4.lines_on_board.find((t) => t.stones.includes("E5") && t.stones.includes("H8"));
  ok("capped four is visible and cannot grow", !!dead && dead.critical_points.length === 0 && dead.note.includes("cannot grow"), dead?.note ?? "missing");
  const blockAt = PRIORITY_LEAN.findIndex((s) => s.startsWith("5. Otherwise, if the opponent has three"));
  const makeAt = PRIORITY_LEAN.findIndex((s) => s.includes("if you can make a three with both ends open"));
  ok("block their open three before making yours", blockAt >= 0 && makeAt > blockAt, `${blockAt} ${makeAt}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

function diagonalShare(board: Board, p: Player): number {
  const own: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === p) own.push(i);
  if (own.length < 2) return 0;
  const col = (i: number) => i % SIZE;
  const row = (i: number) => Math.floor(i / SIZE);
  let on = 0;
  for (const a of own) {
    const hit = own.some((b) => {
      if (b === a) return false;
      const dc = col(b) - col(a), dr = row(b) - row(a);
      const ad = Math.max(Math.abs(dc), Math.abs(dr));
      return dc !== 0 && Math.abs(dc) === Math.abs(dr) && ad > 0 && ad <= 4;
    });
    if (hit) on++;
  }
  return on / own.length;
}

async function play(seed: number, lean: boolean) {
  const rng = makeRng(seed);
  let board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  const openingMoves: string[] = [];
  let jevToMove = true;
  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    if (emptyCells(board).length === 0) {
      return { winner: "draw" as const, plies: ply, openingMoves, diag: diagonalShare(board, JEV) };
    }
    if (jevToMove) {
      const t = await nakedJevMove({
        board, size: SIZE, jev: JEV, history, informed: true, doubleThreat: true,
        priority: lean ? PRIORITY_LEAN : PRIORITY_INITIATIVE,
        leanDiagonal: lean,
      });
      board = applyMove(board, t.moveIdx, JEV);
      history.push({ move: t.move, player: JEV });
      if (openingMoves.length < 4) openingMoves.push(t.move);
      if (isWinningMove(board, SIZE, t.moveIdx)) {
        return { winner: "jev" as const, plies: ply + 1, openingMoves, diag: diagonalShare(board, JEV) };
      }
    } else {
      const idx = opponentMove(board, SIZE, OPP, 3, rng);
      board = applyMove(board, idx, OPP);
      history.push({ move: toLabel(idx, SIZE), player: OPP });
      if (isWinningMove(board, SIZE, idx)) {
        return { winner: "l3" as const, plies: ply + 1, openingMoves, diag: diagonalShare(board, JEV) };
      }
    }
    jevToMove = !jevToMove;
  }
  return { winner: "draw" as const, plies: SIZE * SIZE, openingMoves, diag: diagonalShare(board, JEV) };
}

async function main() {
  if (process.argv.includes("--facts")) {
    facts();
    return;
  }
  facts();
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`\nlean · Jev black vs L3 · 5 seeds × 2 · ${activeTransport()}`);
  console.log(`seeds ${SEEDS.join(",")}\n`);
  let leanBetter = 0, plainBetter = 0, tied = 0, moreDiag = 0;
  const rows: string[] = [];
  for (const seed of SEEDS) {
    process.stdout.write(`  seed ${seed} `);
    const [plain, lean] = await Promise.all([play(seed, false), play(seed, true)]);
    const mark = (w: string) => (w === "jev" ? "W" : w === "l3" ? "L" : "-");
    if (lean.winner === "jev" && plain.winner !== "jev") leanBetter++;
    else if (plain.winner === "jev" && lean.winner !== "jev") plainBetter++;
    else tied++;
    if (lean.diag > plain.diag) moreDiag++;
    rows.push(
      `  ${seed}  详注 ${mark(plain.winner)} ${String(plain.plies).padStart(3)}  ${plain.openingMoves.join(" ").padEnd(16)} diag ${plain.diag.toFixed(2)}` +
      `   斜向 ${mark(lean.winner)} ${String(lean.plies).padStart(3)}  ${lean.openingMoves.join(" ").padEnd(16)} diag ${lean.diag.toFixed(2)}`,
    );
    process.stdout.write(`${mark(plain.winner)}/${mark(lean.winner)}\n`);
  }
  console.log("\n" + rows.join("\n"));
  console.log(`\npaired: 斜向 better ${leanBetter}, 详注 better ${plainBetter}, same result ${tied}`);
  console.log(`diagonal share higher for 斜向 in ${moreDiag}/5`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
