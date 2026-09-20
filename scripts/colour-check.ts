/**
 * Does Jev play with a PLAN as black, or just place stones?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/colour-check.ts [games]
 *
 * `ladder.ts` hardcodes `JEV = 2`, so every strength number in RESULTS.md is
 * Jev-as-white. This plays the same L2 opponent from both seats and, per Jev
 * move, records four things that together describe "章法" — whether the moves
 * add up to something:
 *
 *   top1 / entropy  how peaked the `best_move` distribution is. A flat
 *                   distribution is Jev saying it has no idea.
 *   connected       is the move within one point of a stone Jev already owns?
 *                   Scattering is the literal shape of 没有章法.
 *   clusters        how many disconnected groups Jev's own stones form.
 *   makes           the strongest shape the move creates for Jev.
 *
 * Reported per phase, because the opening is where the state is barest.
 */
import {
  type Board, type Player,
  applyMove, createBoard, emptyCells, isWinningMove, toLabel,
} from "../lib/board";
import { makeRng, opponentMove, placeHandicap } from "../lib/opponent";
import { nakedJevMove, PRIORITY, PRIORITY_INITIATIVE, PRIORITY_SHAPE } from "../lib/jev";
import { enumerateThreats } from "../lib/lines";
import { activeTransport, describeMissingKey } from "../lib/transport";

const SIZE = Number(process.env.BOARD_SIZE ?? 15);
const LEVEL = 2 as const;
const RANK: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };

type Arm = { name: string; jev: Player; priority: string[]; multiAxis?: boolean };
const ARMS: Arm[] = [
  // Shipped: offence-leaning ladder, "extend your own longest line".
  { name: "black+atk", jev: 1, priority: PRIORITY_INITIATIVE },
  // Candidate: same ladder, but item 7 asks for two crossing lines instead of
  // one long one. Same seeds as the arm above.
  { name: "black+shape", jev: 1, priority: PRIORITY_SHAPE },
];

type Rec = {
  seat: string;
  ply: number;      // how many Jev stones were already down
  top1: number;
  entropy: number;  // normalised, 0 = certain, 1 = uniform
  connected: boolean;
  clusters: number;
  makes: number;    // RANK of the best shape this move creates for Jev
  lineFrac: number; // largest share of Jev's stones sitting on ONE line
};

/** Disconnected groups of `p`'s stones, 8-connected with a 1-point gap allowed. */
function clusters(b: Board, size: number, p: Player): number {
  const own = new Set<number>();
  for (let i = 0; i < b.length; i++) if (b[i] === p) own.add(i);
  const seen = new Set<number>();
  let n = 0;
  for (const s of own) {
    if (seen.has(s)) continue;
    n++;
    const stack = [s];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      const c0 = i % size, r0 = Math.floor(i / size);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || c >= size || r < 0 || r >= size) continue;
        const j = r * size + c;
        if (own.has(j) && !seen.has(j)) stack.push(j);
      }
    }
  }
  return n;
}

/**
 * The largest share of `p`'s stones that lie on a single line (gaps allowed).
 * 1.00 means every stone is on one straight line — the shape being complained
 * about. Lower is not automatically better; it is only better if the stones
 * still relate to each other, which `clusters` covers.
 */
function lineFraction(b: Board, size: number, p: Player): number {
  const own: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] === p) own.push(i);
  if (own.length < 2) return 1;
  let best = 1;
  for (const a of own) {
    const ac = a % size, ar = Math.floor(a / size);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      let n = 0;
      for (const o of own) {
        const oc = o % size, or = Math.floor(o / size);
        const dc = oc - ac, dr = or - ar;
        if (dc * dy - dr * dx === 0) n++;   // collinear with `a` along (dx,dy)
      }
      best = Math.max(best, n);
    }
  }
  return best / own.length;
}

function adjacentToOwn(b: Board, size: number, idx: number, p: Player): boolean {
  const c0 = idx % size, r0 = Math.floor(idx / size);
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || c >= size || r < 0 || r >= size) continue;
    if (b[r * size + c] === p) return true;
  }
  return false;
}

function bestShapeFor(b: Board, size: number, idx: number, p: Player): number {
  const label = toLabel(idx, size);
  const want = p === 1 ? "black" : "white";
  let best = 0;
  for (const t of enumerateThreats(b, size, 2)) {
    if (!t.player.startsWith(want)) continue;
    if (!t.stones.includes(label)) continue;
    best = Math.max(best, RANK[t.severity] ?? 0);
  }
  return best;
}

function spread(probs: Record<string, number>) {
  const vs = Object.values(probs).filter((v) => v > 0);
  const sum = vs.reduce((a, b) => a + b, 0) || 1;
  const top1 = Math.max(0, ...vs) / sum;
  let h = 0;
  for (const v of vs) { const q = v / sum; h -= q * Math.log(q); }
  const hMax = Math.log(Math.max(2, Object.keys(probs).length));
  return { top1, entropy: h / hMax };
}

async function playGame(arm: Arm, seed: number, out: Rec[], handicap = 0) {
  const { jev, priority } = arm;
  const rng = makeRng(seed);
  const opp: Player = jev === 1 ? 2 : 1;
  const seat = arm.name;
  let board: Board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  // Stones for the OPPONENT. The point is not severity — it is that the game
  // lasts long enough for Jev to be blocked and have to re-plan, which a 17-ply
  // race never tests.
  if (handicap > 0) {
    board = placeHandicap(board, SIZE, opp, handicap);
    for (let i = 0; i < board.length; i++) {
      if (board[i] === opp) history.push({ move: toLabel(i, SIZE), player: opp });
    }
  }
  let jevStones = 0;
  let jevToMove = jev === 1 || handicap > 0;

  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    if (emptyCells(board).length === 0) return { winner: "draw" as const, plies: ply };
    if (jevToMove) {
      let t;
      try {
        t = await nakedJevMove({ board, size: SIZE, jev, history, informed: true, priority, multiAxis: arm.multiAxis });
      } catch (e: any) {
        return { winner: "opponent" as const, plies: ply, reason: String(e?.message ?? e) };
      }
      const { top1, entropy } = spread(t.probabilities ?? {});
      const connected = jevStones > 0 && adjacentToOwn(board, SIZE, t.moveIdx, jev);
      board = applyMove(board, t.moveIdx, jev);
      history.push({ move: t.move, player: jev });
      jevStones++;
      out.push({
        seat, ply: jevStones, top1, entropy, connected,
        clusters: clusters(board, SIZE, jev),
        makes: bestShapeFor(board, SIZE, t.moveIdx, jev),
        lineFrac: lineFraction(board, SIZE, jev),
      });
      if (isWinningMove(board, SIZE, t.moveIdx)) return { winner: "jev" as const, plies: ply };
    } else {
      const idx = opponentMove(board, SIZE, opp, LEVEL, rng);
      board = applyMove(board, idx, opp);
      history.push({ move: toLabel(idx, SIZE), player: opp });
      if (isWinningMove(board, SIZE, idx)) return { winner: "opponent" as const, plies: ply };
    }
    jevToMove = !jevToMove;
  }
  return { winner: "draw" as const, plies: SIZE * SIZE };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);

function report(recs: Rec[], seat: string, lo: number, hi: number) {
  const r = recs.filter((x) => x.seat === seat && x.ply >= lo && x.ply <= hi);
  if (!r.length) return `${"—".padEnd(46)}`;
  return [
    String(r.length).padStart(4),
    mean(r.map((x) => x.top1)).toFixed(3).padStart(7),
    mean(r.map((x) => x.entropy)).toFixed(3).padStart(8),
    (pct(r.map((x) => x.connected)).toFixed(0) + "%").padStart(10),
    mean(r.map((x) => x.clusters)).toFixed(2).padStart(9),
    mean(r.map((x) => x.makes)).toFixed(2).padStart(6),
    mean(r.map((x) => x.lineFrac)).toFixed(2).padStart(9),
  ].join("");
}

async function main() {
  const games = Number(process.argv[2] ?? 5);
  const handicap = Number(process.argv[3] ?? 0);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`章法 check · ${SIZE}x${SIZE} · L2 opponent · ${games} games/seat · handicap ${handicap} · ${activeTransport()}\n`);

  const recs: Rec[] = [];
  const score: Record<string, { w: number; l: number; d: number; plies: number[] }> = {};
  for (const arm of ARMS) {
    const seat = arm.name;
    score[seat] = { w: 0, l: 0, d: 0, plies: [] };
    process.stdout.write(`  ${seat.padEnd(10)} `);
    for (let g = 0; g < games; g++) {
      // Seeded by colour, not by arm: the two black arms face identical games.
      const r = await playGame(arm, 9000 + arm.jev * 100 + g, recs, handicap);
      const s = score[seat];
      if (r.winner === "jev") s.w++; else if (r.winner === "opponent") s.l++; else s.d++;
      s.plies.push(r.plies);
      process.stdout.write(r.winner === "jev" ? "W" : r.winner === "opponent" ? "L" : "-");
    }
    const s = score[seat];
    console.log(`  ${s.w}-${s.l}${s.d ? ` (${s.d}d)` : ""}  avg ${mean(s.plies).toFixed(1)} plies`);
  }

  console.log(`\n  phase          seat         n    top1  entropy  connected  clusters  makes  1-line`);
  for (const [name, lo, hi] of [["opening 1-4", 1, 4], ["middle  5-9", 5, 9], ["late   10+", 10, 999]] as Array<[string, number, number]>) {
    for (const arm of ARMS) {
      console.log(`  ${name.padEnd(14)} ${arm.name.padEnd(10)}${report(recs, arm.name, lo, hi)}`);
    }
  }
  console.log(`\n  top1/entropy: how peaked best_move is (entropy 1 = uniform = no idea).`);
  console.log(`  connected: % of moves next to a stone Jev already owns. clusters: own groups.`);
  console.log(`  makes: mean severity created (2 two, 3 three, 4 four).`);
  console.log(`  1-line: share of Jev's own stones on a single straight line (1.00 = all of them).`);
}
main();
