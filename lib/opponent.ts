// The measuring stick. Pure TypeScript, no Jev calls — a ruler cannot be made of
// the thing it measures. Deliberately NOT imported by lib/jev.ts: Jev gets no
// help from any of this. It exists to oppose Jev and to place handicap stones.

import {
  type Board,
  type Player,
  applyMove,
  emptyCells,
  isWinningMove,
} from "./board";
import { enumerateThreats } from "./lines";
import { fromLabel as labelToIndex } from "./board";
import { countFours, countOpenThrees } from "./renju";

export type Level = 0 | 1 | 2 | 3;
export const LEVEL_NAMES: Record<Level, string> = {
  0: "random",
  1: "greedy",
  2: "threat",
  3: "vcf",
};

/** Deterministic PRNG so a ladder run can be replayed exactly. */
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

function at(board: Board, size: number, c: number, r: number): number | null {
  if (c < 0 || c >= size || r < 0 || r >= size) return null;
  return board[r * size + c];
}

/**
 * Longest run through `idx` for `player`, plus how many ends are open.
 * `count` includes the stone at idx itself.
 */
function lineInfo(board: Board, size: number, idx: number, player: Player) {
  const c0 = idx % size, r0 = Math.floor(idx / size);
  let best = { count: 0, openEnds: 0 };
  for (const [dx, dy] of DIRS) {
    let count = 1, openEnds = 0;
    for (const sign of [1, -1] as const) {
      let c = c0 + dx * sign, r = r0 + dy * sign;
      while (at(board, size, c, r) === player) { count++; c += dx * sign; r += dy * sign; }
      if (at(board, size, c, r) === 0) openEnds++;
    }
    if (count > best.count || (count === best.count && openEnds > best.openEnds)) {
      best = { count, openEnds };
    }
  }
  return best;
}

/** Empty points within `radius` of any stone; the whole board when empty. */
function candidates(board: Board, size: number, radius = 2): number[] {
  const occupied = board.some((v) => v !== 0);
  if (!occupied) return [Math.floor((size * size) / 2)];
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    const c0 = i % size, r0 = Math.floor(i / size);
    let near = false;
    for (let dr = -radius; dr <= radius && !near; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const v = at(board, size, c0 + dc, r0 + dr);
        if (v !== null && v !== 0) { near = true; break; }
      }
    }
    if (near) out.push(i);
  }
  return out.length ? out : emptyCells(board);
}

function winningPoint(board: Board, size: number, player: Player, pool: number[]): number | null {
  for (const i of pool) {
    if (isWinningMove(applyMove(board, i, player), size, i)) return i;
  }
  return null;
}

/**
 * Best threat this player has on the board, as a numeric weight.
 * Window-based, so split shapes (XX.XX) count — the contiguous version was blind
 * to them, which made this ruler far weaker than a human.
 */
function threatWeight(board: Board, size: number, player: Player): number {
  let best = 0;
  const label = player === 1 ? "black" : "white";
  for (const t of enumerateThreats(board, size, 2)) {
    if (!t.player.startsWith(label)) continue;
    const w =
      t.severity === "five" ? 100000 :
      t.severity === "four" ? (t.critical_points.length >= 2 ? 20000 : 10000) :
      t.severity === "three" ? (t.critical_points.length >= 2 ? 1000 : 100) :
      t.critical_points.length >= 2 ? 50 : 10;
    if (w > best) best = w;
  }
  return best;
}

/** Score a point for `player` by the shape it makes and the shape it denies. */
function scorePoint(board: Board, size: number, idx: number, me: Player, foe: Player): number {
  const mine = threatWeight(applyMove(board, idx, me), size, me);
  const denied = threatWeight(board, size, foe) - threatWeight(applyMove(board, idx, me), size, foe);
  // Slight attacking bias: making a shape beats denying the same shape.
  return mine * 1.1 + denied;
}

// ---------------------------------------------------------------------------
// L3 — the ruler that can actually lose to a plan.
//
// L2 is one ply of greed: it scores a point by the strongest single line it
// makes and the strongest single line it denies. That cannot see two moves
// ahead, so it walks into a forced sequence and it never builds one. Against
// it, Jev-as-black is 8-0 — a saturated reading, which is why every candidate
// improvement to the black request so far could only be measured as harm.
//
// L3 adds the three things that make the difference measurable:
//   1. VCF   — win by continuous fours. Every step forces a unique reply, so
//              the tree is narrow and the search is cheap.
//   2. 双威胁 — a move making two independent threats (四三 / 双三) wins even
//              though no single line of it is a four.
//   3. 一步否决 — reject a candidate if the opponent has a VCF win after it.
//
// Still pure TypeScript. A ruler cannot be made of the thing it measures.
// ---------------------------------------------------------------------------

/** How deep continuous-four search goes, counted in plies (both colours). */
const VCF_DEPTH = 8;
/** Node ceiling per search. Exhausting it returns "no win found", never a hang. */
const VCF_NODES = 400;
/** How many statically-best candidates get the expensive treatment. */
const DEEP_K = 8;
const SHALLOW_K = 20;

type Scan = {
  /** Empty points that immediately complete five-or-more, per player. */
  five: [Set<number>, Set<number>];
  /** Empty points that would create a four, per player. */
  fourMoves: [Set<number>, Set<number>];
};

/**
 * One pass over every 5-cell window, yielding both of the sets VCF needs.
 *
 * A window holding 4 stones of one colour + 1 empty means that empty completes
 * five. A window holding 3 + 2 empties means either empty creates a four. Those
 * are exact, and computing them together costs one scan instead of a simulation
 * per candidate point.
 */
function scanWindows(b: Board, size: number): Scan {
  const scan: Scan = { five: [new Set(), new Set()], fourMoves: [new Set(), new Set()] };
  for (const [dx, dy] of DIRS) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const endC = c + dx * 4, endR = r + dy * 4;
        if (endC < 0 || endC >= size || endR < 0 || endR >= size) continue;
        let black = 0, white = 0;
        const empties: number[] = [];
        for (let k = 0; k < 5; k++) {
          const i = (r + dy * k) * size + (c + dx * k);
          const v = b[i];
          if (v === 0) empties.push(i);
          else if (v === 1) black++;
          else white++;
        }
        if (black && white) continue;
        if (!black && !white) continue;
        const slot = black ? 0 : 1;
        const n = black || white;
        if (n === 4) scan.five[slot].add(empties[0]);
        else if (n === 3) for (const e of empties) scan.fourMoves[slot].add(e);
      }
    }
  }
  return scan;
}

/**
 * A move that wins by continuous fours, or null.
 *
 * Every move considered makes a four, so the defender's reply is forced to the
 * single completion point and the branching factor is the number of fours
 * available — usually one or two. `budget` is shared across the whole tree.
 */
function vcfMove(
  b: Board,
  size: number,
  me: Player,
  depth: number,
  budget: { n: number },
): number | null {
  const foe: Player = me === 1 ? 2 : 1;
  const scan = scanWindows(b, size);
  const myFive = scan.five[me - 1];
  if (myFive.size) return myFive.values().next().value!;
  if (depth <= 0 || budget.n <= 0) return null;
  // A four is only forcing while the opponent has no five of their own to take.
  if (scan.five[foe - 1].size) return null;

  for (const m of scan.fourMoves[me - 1]) {
    if (budget.n-- <= 0) return null;
    if (vcfAfter(b, size, me, m, depth, budget)) return m;
  }
  return null;
}

/**
 * Does the forcing move `m` win for `me`?
 *
 * Split out of `vcfMove` because `winsSoon` needs exactly this and must NOT ask
 * "does the player have a five-completion point" — a plain four is not a win,
 * the opponent simply blocks it. Asking the wrong question made every reply on
 * the board look winning and the defence picked at random.
 */
function vcfAfter(
  b: Board,
  size: number,
  me: Player,
  m: number,
  depth: number,
  budget: { n: number },
): boolean {
  const foe: Player = me === 1 ? 2 : 1;
  const nb = applyMove(b, m, me);
  if (isWinningMove(nb, size, m)) return true;
  const scan = scanWindows(nb, size);
  const comps = [...scan.five[me - 1]];
  if (comps.length === 0) return false;           // not a four: not forcing
  if (scan.five[foe - 1].size) return false;      // they complete five first
  if (comps.length >= 2) return true;             // open four: only one is blockable
  const blk = comps[0];
  const nb2 = applyMove(nb, blk, foe);
  // The forced block can itself be their five. Then it was never a block — it
  // was their winning move, handed to them.
  if (isWinningMove(nb2, size, blk)) return false;
  return vcfMove(nb2, size, me, depth - 1, budget) !== null;
}

/**
 * Independent threats `player` owns after playing `idx`, counted per direction.
 *
 * Two is the winning number: 四三 and 双三 both leave the opponent one move
 * short. `countFours`/`countOpenThrees` come from lib/renju.ts, where the
 * recursive definitions are already written and tested — an open three is a
 * shape one stone away from an OPEN four, not merely three stones in a line.
 */
function threatCount(b: Board, size: number, idx: number, player: Player): number {
  const nb = applyMove(b, idx, player);
  return countFours(nb, size, idx, player) + countOpenThrees(nb, size, idx, player);
}

/**
 * Does `player` win on the spot by playing `idx`?
 *
 * Three shapes qualify and none of them is a plain four:
 *   - an OPEN four (two completion points — only one can be blocked),
 *   - 四三 / 双三, two independent threats made by one stone,
 *   - the first move of a continuous-four sequence.
 *
 * `threatCount` uses lib/renju.ts's recursive definitions, where an open three
 * is a shape one stone away from an OPEN four rather than merely three stones
 * in a line.
 */
function winsSoon(b: Board, size: number, idx: number, player: Player): boolean {
  if (isWinningMove(applyMove(b, idx, player), size, idx)) return true;
  if (threatCount(b, size, idx, player) >= 2) return true;
  // The open four and the continuous-four sequence both live in `vcfAfter`,
  // which judges the move as the FIRST forcing stone rather than asking whether
  // the resulting position happens to contain a four.
  return vcfAfter(b, size, player, idx, VCF_DEPTH, { n: VCF_NODES });
}

/**
 * Every point from which `player` wins soon — their key points.
 *
 * Two generators, and both are needed:
 *
 *   - `scanWindows` gives every point that makes a four. Exact, and it is where
 *     the open four and the start of a VCF live.
 *   - A double threat has to sit where two of their lines cross, so it is a
 *     critical point of at least two threats in DIFFERENT directions. That is
 *     the whole candidate set for 四三 / 双三, and it is small.
 *
 * An earlier version took the top 8 points by static score instead. Those
 * scores tie constantly — every point completing any open three scores the
 * same — so the slice dropped the key point whenever more than eight tied, and
 * the defence walked past a double three it had correctly ranked first-equal.
 */
export function winningReplies(b: Board, size: number, player: Player, foe: Player): number[] {
  const seen = new Set<number>(scanWindows(b, size).fourMoves[player - 1]);
  const label = player === 1 ? "black" : "white";
  const dirs = new Map<number, Set<string>>();
  for (const t of enumerateThreats(b, size, 2)) {
    if (!t.player.startsWith(label)) continue;
    for (const p of t.critical_points) {
      const i = labelToIndex(p, size);
      if (i < 0) continue;
      const set = dirs.get(i) ?? new Set<string>();
      set.add(t.direction);
      dirs.set(i, set);
    }
  }
  for (const [i, ds] of dirs) if (ds.size >= 2) seen.add(i);

  const out: number[] = [];
  for (const i of seen) if (winsSoon(b, size, i, player)) out.push(i);
  return out;
}

/** L3's move. Assumes win-now and block-five were already handled. */
function level3Move(
  board: Board,
  size: number,
  me: Player,
  foe: Player,
  pool: number[],
  rng: () => number,
): number {
  // 1. A forced win by fours, if one exists.
  const forced = vcfMove(board, size, me, VCF_DEPTH, { n: VCF_NODES });
  if (forced !== null) return forced;

  const statik = (i: number) => scorePoint(board, size, i, me, foe) + rng() * 0.01;
  const byScore = (a: { sc: number }, b: { sc: number }) => b.sc - a.sc;

  // 2. Their key points. This is the list the previous version was missing: the
  //    veto could only FILTER my own top candidates, never ADD the saving move,
  //    so whenever the answer was a point I rank low the fallback played on and
  //    lost. Measured: L3-as-white let black make an open four at F7, a point
  //    `scorePoint` scores near zero for white because its `denied` term is a
  //    MAX over the opponent's lines — blocking one of two threes lowers that
  //    max by nothing. Scored from the OPPONENT's side the same point is first.
  const danger = winningReplies(board, size, foe, me);

  if (danger.length) {
    // Defend. A candidate is worth trying only if it can plausibly change the
    // answer: their key points themselves, or a four of my own, which forces
    // them to answer me instead of executing.
    const tries = new Set<number>(danger);
    for (const m of scanWindows(board, size).fourMoves[me - 1]) tries.add(m);
    const ordered = [...tries].map((i) => ({ i, sc: statik(i) })).sort(byScore);
    for (const { i } of ordered) {
      if (winningReplies(applyMove(board, i, me), size, foe, me).length === 0) return i;
    }
    // Nothing defuses it. Take their best point anyway — it is the only square
    // that can matter, and a ruler that resigns early measures nothing.
    return ordered[0].i;
  }

  // 3. Nothing forced against me. Rank by shape made and shape denied, then add
  //    the two-threat terms: making a double threat, and occupying the point
  //    where they would make theirs.
  const shortlist = pool
    .map((i) => ({ i, sc: statik(i) }))
    .sort(byScore)
    .slice(0, SHALLOW_K)
    .map(({ i, sc }) => ({
      i,
      sc: sc
        + (threatCount(board, size, i, me) >= 2 ? 9000 : 0)
        + (threatCount(board, size, i, foe) >= 2 ? 8000 : 0),
    }))
    .sort(byScore);

  // 4. Veto: do not play into a position where they win soon.
  for (const { i } of shortlist.slice(0, DEEP_K)) {
    if (winningReplies(applyMove(board, i, me), size, foe, me).length === 0) return i;
  }
  return shortlist[0].i;
}

/** Pick the opponent's move. Never consults Jev. */
export function opponentMove(
  board: Board,
  size: number,
  me: Player,
  level: Level,
  rng: () => number,
): number {
  const foe: Player = me === 1 ? 2 : 1;
  const empties = emptyCells(board);
  if (empties.length === 0) throw new Error("board full");

  if (level === 0) return empties[Math.floor(rng() * empties.length)];

  const pool = candidates(board, size, level === 1 ? 1 : 2);

  // Both levels take a win and refuse an immediate loss.
  const win = winningPoint(board, size, me, pool);
  if (win !== null) return win;
  const block = winningPoint(board, size, foe, pool);
  if (block !== null) return block;

  if (level === 1) return pool[Math.floor(rng() * pool.length)];
  if (level === 3) return level3Move(board, size, me, foe, pool, rng);

  let best = pool[0], bestScore = -Infinity;
  for (const i of pool) {
    const sc = scorePoint(board, size, i, me, foe) + rng() * 0.01; // tie-break
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return best;
}

/**
 * Place `n` handicap stones for `player` near the centre.
 *
 * NOTE the shape: the offsets are collinear, so n=3 hands the player an open
 * three before a single move is made, and n=4 an effectively won position. That
 * is deliberate for the ladder in scripts/ — it is a severity dial, not a fair
 * handicap — but it is why the UI only offers 0 and 1. If you ever want a
 * playable 2- or 3-stone handicap, scatter the stones onto star points instead.
 */
export function placeHandicap(board: Board, size: number, player: Player, n: number): Board {
  const mid = Math.floor(size / 2);
  // A compact, deliberately strong shape: a broken line through the centre.
  const offsets: Array<[number, number]> = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0],
  ];
  let b = board;
  let placed = 0;
  for (const [dc, dr] of offsets) {
    if (placed >= n) break;
    const c = mid + dc, r = mid + dr;
    if (c < 0 || c >= size || r < 0 || r >= size) continue;
    const i = r * size + c;
    if (b[i] !== 0) continue;
    b = applyMove(b, i, player);
    placed++;
  }
  if (placed < n) throw new Error(`could not place ${n} handicap stones`);
  return b;
}
