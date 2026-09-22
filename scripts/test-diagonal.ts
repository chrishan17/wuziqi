/**
 * Diagonal step off a straight line, for black's first four stones, vs L3.
 *
 *   npx tsx scripts/test-diagonal.ts --facts
 *   npx tsx --env-file-if-exists=.env.local scripts/test-diagonal.ts
 *
 * Ten games: five seeds, each played as 详注 and as 斜向. 详注 is
 * PRIORITY_INITIATIVE + double_threat. 斜向 adds `opening` to the state and
 * uses PRIORITY_DIAGONAL until black has four stones, so a diagonal step
 * outranks extending the straight line into an open three.
 *
 * `--facts` checks the point lists and does not call Jev.
 */
import {
  type Board, type Player,
  applyMove, createBoard, emptyCells, fromLabel, isWinningMove, toLabel,
} from "../lib/board";
import { diagonalOpening } from "../lib/lines";
import { makeRng, opponentMove } from "../lib/opponent";
import { nakedJevMove, priorityFor } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const SIZE = 15;
const JEV: Player = 1;
const OPP: Player = 2;
const SEEDS = [13000, 13001, 13002, 13003, 13004];

function put(board: Board, label: string, p: Player) {
  board[fromLabel(label, SIZE)] = p;
}

function facts() {
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, extra = "") => {
    if (cond) { pass++; console.log(`  PASS ${name}`); }
    else { fail++; console.log(`  FAIL ${name} ${extra}`); }
  };
  const has = (xs: string[] | undefined, label: string) => !!xs?.includes(label);

  let b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "H7", 2);
  let o = diagonalOpening(b, SIZE, 1);
  ok("vertical contact", o?.your_line === "vertical", JSON.stringify(o?.your_line));
  ok("diagonals off vertical", ["G7", "I7", "G9", "I9"].every((l) => has(o?.diagonal_off_that_line, l)));
  ok("H9 and H6 lengthen it", has(o?.straight_extensions, "H9") && has(o?.straight_extensions, "H6"));
  ok("H7 is white", !has(o?.diagonal_off_that_line, "H7") && !has(o?.straight_extensions, "H7"));

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I8", 1);
  o = diagonalOpening(b, SIZE, 1);
  ok("horizontal pair", o?.your_line === "horizontal");
  ok("J8 lengthens", has(o?.straight_extensions, "J8") && has(o?.straight_extensions, "G8"));
  ok("I7 is a diagonal step", has(o?.diagonal_off_that_line, "I7"));
  ok("I8 itself is absent", !has(o?.diagonal_off_that_line, "I8") && !has(o?.straight_extensions, "I8"));

  b = createBoard(SIZE);
  put(b, "H8", 1); put(b, "I7", 1);
  ok("diagonal pair emits nothing", diagonalOpening(b, SIZE, 1) === null);

  b = createBoard(SIZE);
  ok("empty board emits nothing", diagonalOpening(b, SIZE, 1) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

function ownCount(board: Board, p: Player) {
  let n = 0;
  for (const c of board) if (c === p) n++;
  return n;
}

function lineFraction(board: Board, p: Player): number {
  const own: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === p) own.push(i);
  if (own.length < 2) return 1;
  let best = 1;
  for (const a of own) {
    const ac = a % SIZE, ar = Math.floor(a / SIZE);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      let n = 1;
      for (const b of own) {
        if (b === a) continue;
        const dc = b % SIZE - ac, dr = Math.floor(b / SIZE) - ar;
        if (dc * dy === dr * dx) n++;
      }
      if (n > best) best = n;
    }
  }
  return best / own.length;
}

async function play(seed: number, diagonal: boolean) {
  const rng = makeRng(seed);
  let board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  const openingMoves: string[] = [];
  let line4 = 1;
  let jevToMove = true;
  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    if (emptyCells(board).length === 0) return { winner: "draw" as const, plies: ply, openingMoves, line4 };
    if (jevToMove) {
      const n = ownCount(board, JEV);
      const t = await nakedJevMove({
        board, size: SIZE, jev: JEV, history, informed: true, doubleThreat: true,
        priority: priorityFor(JEV, n, false, diagonal),
        diagonalOpening: diagonal && n < 4,
      });
      board = applyMove(board, t.moveIdx, JEV);
      history.push({ move: t.move, player: JEV });
      if (openingMoves.length < 4) openingMoves.push(t.move);
      if (ownCount(board, JEV) === 4) line4 = lineFraction(board, JEV);
      if (isWinningMove(board, SIZE, t.moveIdx)) return { winner: "jev" as const, plies: ply + 1, openingMoves, line4 };
    } else {
      const idx = opponentMove(board, SIZE, OPP, 3, rng);
      board = applyMove(board, idx, OPP);
      history.push({ move: toLabel(idx, SIZE), player: OPP });
      if (isWinningMove(board, SIZE, idx)) return { winner: "l3" as const, plies: ply + 1, openingMoves, line4 };
    }
    jevToMove = !jevToMove;
  }
  return { winner: "draw" as const, plies: SIZE * SIZE, openingMoves, line4 };
}

async function main() {
  if (process.argv.includes("--facts")) {
    facts();
    return;
  }
  facts();
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`\ndiagonal · Jev black vs L3 · 5 seeds × 2 · ${activeTransport()}`);
  console.log(`seeds ${SEEDS.join(",")}\n`);
  let diagBetter = 0, plainBetter = 0, tied = 0, shape = 0;
  const rows: string[] = [];
  for (const seed of SEEDS) {
    process.stdout.write(`  seed ${seed} `);
    const [plain, diag] = await Promise.all([play(seed, false), play(seed, true)]);
    const mark = (w: string) => (w === "jev" ? "W" : w === "l3" ? "L" : "-");
    if (diag.winner === "jev" && plain.winner !== "jev") diagBetter++;
    else if (plain.winner === "jev" && diag.winner !== "jev") plainBetter++;
    else tied++;
    if (diag.line4 < plain.line4) shape++;
    rows.push(
      `  ${seed}  详注 ${mark(plain.winner)} ${String(plain.plies).padStart(3)}  ${plain.openingMoves.join(" ").padEnd(16)} 1-line ${plain.line4.toFixed(2)}` +
      `   斜向 ${mark(diag.winner)} ${String(diag.plies).padStart(3)}  ${diag.openingMoves.join(" ").padEnd(16)} 1-line ${diag.line4.toFixed(2)}`,
    );
    process.stdout.write(`${mark(plain.winner)}/${mark(diag.winner)}\n`);
  }
  console.log("\n" + rows.join("\n"));
  console.log(`\npaired: 斜向 better ${diagBetter}, 详注 better ${plainBetter}, same result ${tied}`);
  console.log(`1-line lower for 斜向 in ${shape}/5`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
