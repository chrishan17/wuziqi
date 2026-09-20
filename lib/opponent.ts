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

export type Level = 0 | 1 | 2;
export const LEVEL_NAMES: Record<Level, string> = {
  0: "random",
  1: "greedy",
  2: "threat",
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
