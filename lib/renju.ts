// 禁手 (forbidden moves) — Renju rules.
//
// Forbidden moves apply to BLACK only. Black moves first, so the restrictions
// exist to cancel that advantage. White is unrestricted: white may overline,
// double-three, double-four freely, and six in a row still wins for white.
//
// Definitions used here, one level of recursion deep:
//   four        — a shape where one more black stone makes EXACTLY five
//   open four   — a four with two distinct completing points (unstoppable)
//   open three  — a shape where one more black stone makes an OPEN four
//   長連 overline — six or more black stones in an unbroken line
//
// 五連優先: a move that makes exactly five wins even if it also forms a
// double-three or double-four. Overline is never a five, so it stays forbidden.
//
// KNOWN SIMPLIFICATION: nested resolution is not performed. Strict Renju says a
// three does not count if the point completing it is itself a forbidden point.
// Resolving that fully is recursive and can be ambiguous; this implementation
// evaluates one level and treats every completing point as legal.

import { type Board, type Player, applyMove, emptyCells } from "./board";

export type Rules = {
  /** 三三: two or more open threes in one move. */
  doubleThree: boolean;
  /** 四四: two or more fours in one move. */
  doubleFour: boolean;
  /** 長連: six or more in an unbroken line. */
  overline: boolean;
};

export const FREESTYLE: Rules = { doubleThree: false, doubleFour: false, overline: false };
export const RENJU: Rules = { doubleThree: true, doubleFour: true, overline: true };

export type ForbiddenKind = "doubleThree" | "doubleFour" | "overline";

export const RULE_NAME: Record<ForbiddenKind, string> = {
  doubleThree: "三三禁手",
  doubleFour: "四四禁手",
  overline: "长连禁手",
};

export type Outcome =
  | { kind: "win" }
  | { kind: "forbidden"; rule: ForbiddenKind }
  | { kind: "none" };

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

function cellAt(b: Board, size: number, c: number, r: number): number | null {
  if (c < 0 || c >= size || r < 0 || r >= size) return null;
  return b[r * size + c];
}

/** Length of the unbroken run through idx along one direction. */
function runLength(b: Board, size: number, idx: number, dx: number, dy: number): number {
  const p = b[idx];
  const c0 = idx % size, r0 = Math.floor(idx / size);
  let n = 1;
  for (const sign of [1, -1] as const) {
    let c = c0 + dx * sign, r = r0 + dy * sign;
    while (cellAt(b, size, c, r) === p) { n++; c += dx * sign; r += dy * sign; }
  }
  return n;
}

/** The longest unbroken run through idx, any direction. */
export function longestRun(b: Board, size: number, idx: number): number {
  let best = 0;
  for (const [dx, dy] of DIRS) best = Math.max(best, runLength(b, size, idx, dx, dy));
  return best;
}

/** Empty points near the line through idx, where a follow-up could land. */
function lineNeighbourhood(size: number, idx: number, dx: number, dy: number): number[] {
  const c0 = idx % size, r0 = Math.floor(idx / size);
  const out: number[] = [];
  for (let k = -5; k <= 5; k++) {
    if (k === 0) continue;
    const c = c0 + dx * k, r = r0 + dy * k;
    if (c < 0 || c >= size || r < 0 || r >= size) continue;
    out.push(r * size + c);
  }
  return out;
}

/**
 * Points that would make EXACTLY five for `player` along this direction.
 * Six or more does not count — that is an overline, not a five.
 */
function fiveCompletions(b: Board, size: number, idx: number, player: Player, dx: number, dy: number): number[] {
  const out: number[] = [];
  for (const p of lineNeighbourhood(size, idx, dx, dy)) {
    if (b[p] !== 0) continue;
    const nb = applyMove(b, p, player);
    if (runLength(nb, size, p, dx, dy) === 5) out.push(p);
  }
  return out;
}

/** Is there a four in this direction — i.e. one stone completes exactly five? */
function isFour(b: Board, size: number, idx: number, player: Player, dx: number, dy: number): boolean {
  if (runLength(b, size, idx, dx, dy) >= 5) return false; // already five or more
  return fiveCompletions(b, size, idx, player, dx, dy).length >= 1;
}

/** Is there an OPEN four here — two distinct points each completing exactly five? */
function isOpenFour(b: Board, size: number, idx: number, player: Player, dx: number, dy: number): boolean {
  if (runLength(b, size, idx, dx, dy) >= 5) return false;
  return fiveCompletions(b, size, idx, player, dx, dy).length >= 2;
}

/**
 * Is there an open three in this direction — one more stone makes an open four?
 * This is the recursive step, evaluated one level deep.
 */
function isOpenThree(b: Board, size: number, idx: number, player: Player, dx: number, dy: number): boolean {
  if (runLength(b, size, idx, dx, dy) >= 5) return false;
  // A shape that already completes to five is a four, not a three. Without this
  // guard, dropping an irrelevant stone elsewhere on the line leaves the
  // existing open four standing and the shape reports as an open three —
  // which made 四三 (legal) judge as 三三 (forbidden).
  if (isFour(b, size, idx, player, dx, dy)) return false;
  for (const p of lineNeighbourhood(size, idx, dx, dy)) {
    if (b[p] !== 0) continue;
    const nb = applyMove(b, p, player);
    // The follow-up must sit on the same line as idx, so check from idx.
    if (isOpenFour(nb, size, idx, player, dx, dy)) return true;
  }
  return false;
}

/** Number of directions through idx that carry a four. */
export function countFours(b: Board, size: number, idx: number, player: Player): number {
  let n = 0;
  for (const [dx, dy] of DIRS) if (isFour(b, size, idx, player, dx, dy)) n++;
  return n;
}

/** Number of directions through idx that carry an open three. */
export function countOpenThrees(b: Board, size: number, idx: number, player: Player): number {
  let n = 0;
  for (const [dx, dy] of DIRS) if (isOpenThree(b, size, idx, player, dx, dy)) n++;
  return n;
}

/**
 * What happens when `player` plays `idx` on `board` (idx must already be empty).
 * `board` is the position BEFORE the move.
 */
export function outcomeOf(
  board: Board,
  size: number,
  idx: number,
  player: Player,
  rules: Rules,
): Outcome {
  const b = applyMove(board, idx, player);
  const run = longestRun(b, size, idx);

  // White is unrestricted: five or more simply wins.
  if (player === 2) return run >= 5 ? { kind: "win" } : { kind: "none" };

  // 五連優先 — exactly five wins regardless of any other shape formed.
  if (run === 5) return { kind: "win" };

  if (run >= 6) {
    // With 長連禁手 off this is free-style, where an overline still wins.
    return rules.overline ? { kind: "forbidden", rule: "overline" } : { kind: "win" };
  }

  if (rules.doubleFour && countFours(b, size, idx, player) >= 2) {
    return { kind: "forbidden", rule: "doubleFour" };
  }
  if (rules.doubleThree && countOpenThrees(b, size, idx, player) >= 2) {
    return { kind: "forbidden", rule: "doubleThree" };
  }
  return { kind: "none" };
}

/** Every point where black would immediately lose. Used for UI marking. */
export function forbiddenPoints(board: Board, size: number, rules: Rules): Map<number, ForbiddenKind> {
  const out = new Map<number, ForbiddenKind>();
  if (!rules.doubleThree && !rules.doubleFour && !rules.overline) return out;
  for (const i of emptyCells(board)) {
    const o = outcomeOf(board, size, i, 1, rules);
    if (o.kind === "forbidden") out.set(i, o.rule);
  }
  return out;
}
