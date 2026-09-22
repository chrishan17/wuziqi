/**
 * Black opening, 详注 vs 执黑先行, against L3. Ten games total.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-opening-l3.ts
 *
 * Five seeds, each played twice: once with the shipped ladder
 * (`PRIORITY_INITIATIVE` + `doubleThreat`, what 详注 sends) and once with
 * `PRIORITY_OPENING` for black's first four stones only. Same seed, so white's
 * dice match until black's move diverges.
 *
 * Pre-registered, before the run: ten games cannot settle a win rate. Ship the
 * opening text only if it wins more paired games than it loses AND black's
 * fourth stone is off the single line more often. A tie, or a shape change
 * with no extra wins, stays unshipped.
 */
import {
  type Board, type Player,
  applyMove, createBoard, emptyCells, isWinningMove, toLabel,
} from "../lib/board";
import { makeRng, opponentMove } from "../lib/opponent";
import { nakedJevMove, priorityFor } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const SIZE = 15;
const JEV: Player = 1;
const OPP: Player = 2;
const SEEDS = [12000, 12001, 12002, 12003, 12004];

function ownCount(board: Board, p: Player) {
  let n = 0;
  for (const c of board) if (c === p) n++;
  return n;
}

/** Share of `p`'s stones on one straight line, gaps allowed. */
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

async function play(seed: number, opening: boolean) {
  const rng = makeRng(seed);
  let board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  const openingMoves: string[] = [];
  let line4 = 1;
  let jevToMove = true;

  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    if (emptyCells(board).length === 0) return { winner: "draw" as const, plies: ply, openingMoves, line4 };
    if (jevToMove) {
      const t = await nakedJevMove({
        board, size: SIZE, jev: JEV, history, informed: true, doubleThreat: true,
        priority: priorityFor(JEV, ownCount(board, JEV), opening),
      });
      board = applyMove(board, t.moveIdx, JEV);
      history.push({ move: t.move, player: JEV });
      if (openingMoves.length < 4) openingMoves.push(t.move);
      if (ownCount(board, JEV) === 4) line4 = lineFraction(board, JEV);
      if (isWinningMove(board, SIZE, t.moveIdx)) {
        return { winner: "jev" as const, plies: ply + 1, openingMoves, line4 };
      }
    } else {
      const idx = opponentMove(board, SIZE, OPP, 3, rng);
      board = applyMove(board, idx, OPP);
      history.push({ move: toLabel(idx, SIZE), player: OPP });
      if (isWinningMove(board, SIZE, idx)) {
        return { winner: "l3" as const, plies: ply + 1, openingMoves, line4 };
      }
    }
    jevToMove = !jevToMove;
  }
  return { winner: "draw" as const, plies: SIZE * SIZE, openingMoves, line4 };
}

async function main() {
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`opening · Jev black vs L3 · 5 seeds × 2 · ${activeTransport()}`);
  console.log(`seeds ${SEEDS.join(",")} · 详注 = initiative + double_threat · 执黑 = opening text for the first four stones\n`);

  let jevBetter = 0, l3Better = 0, tied = 0;
  const rows: string[] = [];
  for (const seed of SEEDS) {
    process.stdout.write(`  seed ${seed} `);
    const [plain, told] = await Promise.all([play(seed, false), play(seed, true)]);
    const mark = (w: string) => (w === "jev" ? "W" : w === "l3" ? "L" : "-");
    if (told.winner === "jev" && plain.winner !== "jev") jevBetter++;
    else if (plain.winner === "jev" && told.winner !== "jev") l3Better++;
    else tied++;
    const row =
      `  ${seed}  详注 ${mark(plain.winner)} ${String(plain.plies).padStart(3)}  ${plain.openingMoves.join(" ").padEnd(16)} 1-line ${plain.line4.toFixed(2)}` +
      `   执黑 ${mark(told.winner)} ${String(told.plies).padStart(3)}  ${told.openingMoves.join(" ").padEnd(16)} 1-line ${told.line4.toFixed(2)}`;
    rows.push(row);
    process.stdout.write(`${mark(plain.winner)}/${mark(told.winner)}\n`);
  }
  console.log("\n" + rows.join("\n"));
  console.log(`\npaired: 执黑 better ${jevBetter}, 详注 better ${l3Better}, same result ${tied}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
