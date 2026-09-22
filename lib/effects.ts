// What each candidate point would CREATE, for both purposes at once.
//
// `lines_on_board` describes shapes that already exist. It says nothing about
// what a move would make, so a point that blocks black AND builds white reads
// exactly like a point that only blocks. That is the whole difference between
// defending and playing, and it was invisible in the state.
//
// Facts only: each entry states what the point does for white and which black
// threat it answers. There is no "dual purpose" flag and no recommendation —
// a point carrying both fields simply carries both fields.

import { type Board, type Player, applyMove, emptyCells, fromLabel, toLabel } from "./board";
import { DIR_VEC, enumerateThreats, type Threat } from "./lines";

/**
 * Keys are named for the actual colours, not for "the model" and "the opponent":
 * Jev may play either side, and a field called `for_white` describing what BLACK
 * builds is precisely the kind of state-encoding lie this project keeps getting
 * bitten by. `keysFor()` picks the pair; `mine`/`theirs` read them back.
 */
export type PointEffect = {
  point: string;
  for_white?: string;
  for_black?: string;
  blocks_black?: string;
  blocks_white?: string;
  /**
   * Every direction this point builds in, not just the strongest one.
   *
   * Without it a point sitting on TWO of your lines is indistinguishable from
   * one that extends a single line — both collapse to the same phrase — and a
   * point making two separate "two"s is dropped entirely for being below the
   * three threshold. Those are exactly the points a double threat grows from,
   * so the state could not express the only shape that actually wins, and the
   * priority ladder ("extend your own longest line") pushed the other way.
   * Third instance of this project's recurring bug: the encoding hid a
   * relationship, and the model was blamed.
   */
  builds_on?: string[];
  /**
   * The two-or-more FORCING shapes (a four, or an open three) this point makes
   * AT ONCE, in different directions — 四四, 四三 and 双三. A blocked three is
   * not forcing and never counts. Only ever present when there are at
   * least two, so the field's presence IS the fact.
   *
   * Not a rerun of `builds_on`, which was measured and rejected (6-2 vs 8-0):
   * that listed EVERY direction down to "two" and grew the list from 15 entries
   * to 24, which is the dilution this project keeps paying for. This fires on a
   * handful of points per game, and it is the only shape that actually wins —
   * `for_black`/`for_white` collapse a point to its single strongest shape, so
   * a move making a four AND an open three reads exactly like a plain four.
   */
  double_threat?: string[];
  /**
   * `doubleThreat: "split"` only. The point makes shapes of three-or-better on
   * two or more lines at once, but fewer than two of them force an answer —
   * e.g. two blocked threes, or a four plus a blocked three. States the shapes
   * and stops, like every field here. The old definition called these
   * `double_threat`; this keeps the same points at the same rank under a
   * name that is true.
   */
  shapes_on_two_lines?: string[];
  /**
   * Beside a `blocks_*` three: what that line can still make for the opponent
   * once this point is taken. Two ends of an open three are not equal — one can
   * leave a four (and the four can be half of a 四三), the other can kill the
   * line — and before this field both ends read identically. Seeds 51010 and
   * 51012 were lost on exactly that choice. A fact about the board after the
   * block; it names no move.
   */
  leaves?: string;
  /**
   * What the OPPONENT would make by playing here — but only when that is two or
   * more forcing threats (fours or open threes), i.e. a 四三 / 双三 they cannot be
   * stopped from converting.
   *
   * This is the hole the rest of the file could not express. `blocks_black` /
   * `blocks_white` are built from the critical points of threats that ALREADY
   * exist, so a point from which the opponent would CREATE an unanswerable
   * double threat carries no field at all — it reads as an empty point like any
   * other. Measured over 8 games against L3: positions where exactly such a
   * point had to be taken arose 31 times and Jev missed 20 of them (65%), while
   * it missed 0/5 immediate fives. That is where black's losses actually come
   * from, and the state was silent about it.
   *
   * Still a fact and not advice: it says what the opponent would make, names no
   * best move, and draws no conclusion.
   */
  white_would_make?: string[];
  black_would_make?: string[];
};

function keysFor(me: Player) {
  return me === 2
    ? { build: "for_white" as const, block: "blocks_black" as const, theirs: "black_would_make" as const }
    : { build: "for_black" as const, block: "blocks_white" as const, theirs: "white_would_make" as const };
}

/** What this point builds for the player the effects were computed for. */
export const mine = (e: PointEffect) => e.for_white ?? e.for_black;
/** Which opponent threat this point answers. */
export const theirs = (e: PointEffect) => e.blocks_black ?? e.blocks_white;

const RANK: Record<string, number> = { five: 5, four: 4, three: 3, two: 2 };

/**
 * How `double_threat` is computed.
 *
 *   true / "fixed"  only FORCING shapes count (a four, or an open three).
 *   "legacy"        any three counts, blocked or not — the pre-2026-09-23
 *                   definition the +8.2pp was measured on. Two blocked threes
 *                   come out labelled as a double threat. Measurement only.
 *   "split"         `double_threat` as in "fixed", and a point that makes
 *                   three-or-better on two or more lines without two forcing
 *                   shapes gets `shapes_on_two_lines` instead. Same points and
 *                   same ordering as "legacy"; only the name is honest.
 */
export type DoubleThreatMode = boolean | "fixed" | "legacy" | "split";

/** A shape the opponent must answer: five, any four, or an open three. */
function isForcing(v: { sev: string; ends: number }): boolean {
  return RANK[v.sev] >= 4 || (v.sev === "three" && v.ends >= 2);
}

function severityPhrase(sev: string, openEnds: number): string {
  if (sev === "five") return "makes five — wins immediately";
  // States the shape, not its outcome. "— unstoppable" was false whenever the
  // opponent could make five first, and Jev took it at 70% over the block (seed 51010).
  if (sev === "four") return openEnds >= 2 ? "makes an open four (two points complete five)" : "makes a four";
  if (sev === "three") return openEnds >= 2 ? "makes an open three" : "makes a blocked three";
  return "extends to two";
}

/**
 * After `me` takes `blockIdx`, what can the opponent's line `t` still make?
 * Every point where one more opponent stone makes a four on that line, or —
 * when there is none — whether any five-cell window of it is still free.
 */
function leftAfterBlock(board: Board, size: number, t: Threat, blockIdx: number, me: Player): string {
  const foe: Player = me === 1 ? 2 : 1;
  const foeName = foe === 1 ? "black" : "white";
  const [dx, dy] = DIR_VEC[t.direction];
  const after = applyMove(board, blockIdx, me);
  const stones = t.stones.map((l) => fromLabel(l, size));
  const cell = (i: number, k: number) => {
    const c = (i % size) + k * dx, r = Math.floor(i / size) + k * dy;
    return c < 0 || c >= size || r < 0 || r >= size ? -1 : r * size + c;
  };
  const fours = new Set<string>();
  for (const s0 of stones) {
    for (let k = -4; k <= 4; k++) {
      const q = cell(s0, k);
      if (q < 0 || after[q] !== 0) continue;
      const a2 = applyMove(after, q, foe);
      const q4 = toLabel(q, size);
      for (const u of enumerateThreats(a2, size, 4)) {
        if (u.player !== t.player || u.direction !== t.direction || u.severity !== "four") continue;
        if (!u.stones.includes(q4) || u.stones.filter((x) => t.stones.includes(x)).length < 2) continue;
        fours.add(q4);
      }
    }
  }
  if (fours.size) return `${foeName} can still make a four on this line at ${[...fours].join(" or ")}`;
  for (const s0 of stones) {
    for (let start = -4; start <= 0; start++) {
      let open = true;
      for (let k = start; k < start + 5 && open; k++) {
        const q = cell(s0, k);
        if (q < 0 || after[q] === me) open = false;
      }
      if (open) return `${foeName} cannot make a four on this line with one stone, but the line still has room for five`;
    }
  }
  return "this line can no longer make five";
}

/** Empty points within `radius` of any stone. */
function nearby(b: Board, size: number, radius = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) continue;
    const c0 = i % size, r0 = Math.floor(i / size);
    let near = false;
    for (let dr = -radius; dr <= radius && !near; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || c >= size || r < 0 || r >= size) continue;
        if (b[r * size + c] !== 0) { near = true; break; }
      }
    }
    if (near) out.push(i);
  }
  return out;
}

export function pointEffects(
  board: Board,
  size: number,
  me: Player = 2,
  /** Emit `builds_on` and keep multi-direction points. Off = previous behaviour. */
  multiAxis = false,
  /** Emit `double_threat` on points making two forcing shapes. See `DoubleThreatMode`. */
  doubleThreat: DoubleThreatMode = false,
  /** Emit `<colour>_would_make`: points where the OPPONENT would make a 四三 / 双三. */
  keyPoints = false,
  /** Name the direction of the strongest shape. Diagonal wins a tie with a straight line of the same severity. */
  withDirection = false,
  /** Emit `leaves` on blocks of a three, rank blocks by it, and give `shapes_on_two_lines` +12 instead of +45. */
  blockLeaves = false,
  /**
   * Do not emit `blocks_*` for a blocked three. It can only become a four,
   * which one stone answers, and when it is half of a real double threat
   * `<colour>_would_make` already names the point. As a bare entry it was the
   * commonest lure away from the opponent's key point (4 of 9 real misses).
   */
  dropBlockedThreeBlocks = false,
): PointEffect[] {
  const foe: Player = me === 1 ? 2 : 1;
  const foeLabel = foe === 1 ? "black" : "white";
  const K = keysFor(me);

  // Opponent threats worth answering, and the points that answer them.
  // The phrase says whether the three is open. A blocked three being answered
  // and an open three that must be stopped used to read identically.
  const blockMap = new Map<string, { desc: string; rank: number; t: Threat }>();
  for (const t of enumerateThreats(board, size, 3)) {
    if (!t.player.startsWith(foeLabel)) continue;
    if (RANK[t.severity] < 3) continue;
    if (dropBlockedThreeBlocks && t.severity === "three" && !t.live) continue;
    const kind = t.severity === "three" ? (t.live ? "open three" : "blocked three") : t.severity;
    // An open three outranks a blocked one; a four outranks both.
    const rank = RANK[t.severity] * 2 + (t.live ? 1 : 0);
    for (const p of t.critical_points) {
      // A four's critical point is where the opponent completes five.
      const desc = `${kind} ${t.stones.join("-")} (${t.direction})` +
        (t.severity === "four" ? ` — ${foeLabel} makes five here on their next move` : "");
      const prev = blockMap.get(p);
      // keep the most severe threat this point answers
      if (!prev || rank > prev.rank) blockMap.set(p, { desc, rank, t });
    }
  }

  const out: PointEffect[] = [];
  for (const idx of nearby(board, size, 2)) {
    const label = toLabel(idx, size);
    const after = applyMove(board, idx, me);

    // best shape this point gives the player to move, and every direction it
    // builds in — the strongest alone cannot express a double threat.
    let best: { sev: string; ends: number; dir: string } | null = null;
    const byDir = new Map<string, { sev: string; ends: number }>();
    for (const t of enumerateThreats(after, size, 2)) {
      if (t.player.startsWith(foeLabel)) continue;
      if (!t.stones.includes(label)) continue;
      const diagTie = withDirection
        && !!best
        && RANK[t.severity] === RANK[best.sev]
        && t.direction.startsWith("diagonal")
        && !best.dir.startsWith("diagonal");
      if (!best || RANK[t.severity] > RANK[best.sev] || diagTie) {
        best = { sev: t.severity, ends: t.live ? 2 : 1, dir: t.direction };
      }
      const prev = byDir.get(t.direction);
      const ends = t.live ? 2 : 1;
      // Same severity: keep the open one. Otherwise a blocked three found first
      // hides an open three in the same direction.
      if (!prev || RANK[t.severity] > RANK[prev.sev] || (RANK[t.severity] === RANK[prev.sev] && ends > prev.ends)) {
        byDir.set(t.direction, { sev: t.severity, ends });
      }
    }

    // Two independent threats from one stone. Read off the per-direction map
    // that is already built above, so it costs nothing extra. Only a FORCING
    // shape counts: a four, or an OPEN three. A blocked three forces nothing,
    // and counting it labelled two blocked threes as 四三 / 双三 — 70 of 131
    // labels in the logged human games were that, sorted above a real four.
    const phrases = (xs: Array<[string, { sev: string; ends: number }]>) => xs
      .sort((a, b2) => RANK[b2[1].sev] - RANK[a[1].sev])
      .map(([dir, v]) => `${severityPhrase(v.sev, v.ends)} (${dir})`);
    const forcing = [...byDir].filter(([, v]) => isForcing(v));
    const threes = [...byDir].filter(([, v]) => RANK[v.sev] >= 3);
    let dual: string[] | null = null;
    let twoLines: string[] | null = null;
    if (doubleThreat === "legacy") {
      if (threes.length >= 2) dual = phrases(threes);
    } else if (doubleThreat) {
      if (forcing.length >= 2) dual = phrases(forcing);
      else if (doubleThreat === "split" && threes.length >= 2) twoLines = phrases(threes);
    }

    // What the OPPONENT would make here. Same per-direction count, their stone.
    let theirDual: string[] | null = null;
    if (keyPoints) {
      const afterFoe = applyMove(board, idx, foe);
      const foeDir = new Map<string, { sev: string; ends: number }>();
      for (const t of enumerateThreats(afterFoe, size, 3)) {
        if (!t.player.startsWith(foeLabel)) continue;
        if (!t.stones.includes(label)) continue;
        if (RANK[t.severity] < 3) continue;
        const prev = foeDir.get(t.direction);
        const ends = t.live ? 2 : 1;
        if (!prev || RANK[t.severity] > RANK[prev.sev] || (RANK[t.severity] === RANK[prev.sev] && ends > prev.ends)) {
          foeDir.set(t.direction, { sev: t.severity, ends });
        }
      }
      // Same rule as `double_threat`: blocked threes are not threats.
      const forcing = [...foeDir].filter(([, v]) => isForcing(v));
      if (forcing.length >= 2) {
        theirDual = forcing
          .sort((a, b2) => RANK[b2[1].sev] - RANK[a[1].sev])
          .map(([dir, v]) => `${severityPhrase(v.sev, v.ends).replace("makes", "would make")} (${dir})`);
      }
    }

    const blockEntry = blockMap.get(label);
    const blocks = blockEntry?.desc;
    // Open threes only: that is where the blocking points differ in what they
    // leave. On a blocked three "this line can no longer make five" read as a
    // reason to play there, and Jev took it over the opponent's key point (51003).
    const leaves = blockLeaves && blockEntry && blockEntry.t.severity === "three" && blockEntry.t.live
      ? leftAfterBlock(board, size, blockEntry.t, idx, me)
      : undefined;
    const makesSomething = best && RANK[best.sev] >= 3;
    // A point on two of your own lines is worth stating even when neither line
    // has reached a three yet — that is where a double threat starts.
    const multi = multiAxis && byDir.size >= 2;
    if (!makesSomething && !blocks && !multi && !dual && !twoLines && !theirDual) continue;

    const phrase = best && RANK[best.sev] >= 2
      ? severityPhrase(best.sev, best.ends) + (withDirection ? ` (${best.dir})` : "")
      : null;
    out.push({
      point: label,
      ...(phrase ? { [K.build]: phrase } : {}),
      ...(multi
        ? {
            builds_on: [...byDir]
              .sort((a, b2) => RANK[b2[1].sev] - RANK[a[1].sev])
              .map(([dir, v]) => `${severityPhrase(v.sev, v.ends)} (${dir})`),
          }
        : {}),
      ...(dual ? { double_threat: dual } : {}),
      ...(twoLines ? { shapes_on_two_lines: twoLines } : {}),
      ...(theirDual ? { [K.theirs]: theirDual } : {}),
      ...(blocks ? { [K.block]: blocks } : {}),
      ...(leaves ? { leaves } : {}),
    });
  }

  // Lines where some blocking point leaves the opponent no four. Only there is
  // a block that leaves a four the worse choice — for a plain open three both
  // ends leave one, and neither is demoted.
  const cleanBlock = new Set(
    out.filter((e) => theirs(e) && e.leaves && !e.leaves.includes("can still make a four")).map((e) => theirs(e)!),
  );

  // Points doing both come first; then by what they build. Ordering is itself
  // information the model reads.
  const score = (e: PointEffect) => {
    const build = mine(e), block = theirs(e);
    // A block that leaves the opponent a four on that line is only half a
    // block: it does not earn the attack-while-defending bonus, and it ranks
    // below a block that leaves no four (51010: E8 left a four at G6 and sat
    // at #0 on that bonus; the gap point G6, the only real defence, was #12).
    const partial = !!e.leaves && e.leaves.includes("can still make a four") && cleanBlock.has(theirs(e)!);
    // Under `blockLeaves`, answering a blocked three is not defending anything.
    const urgent = !blockLeaves || !block?.startsWith("blocked three");
    const both = build && block && !partial && urgent ? 100 : 0;
    // Extra directions are a TIE-BREAKER, not a promotion. Weighted so a
    // triple-two (10 + 16 = 26) still ranks below a plain four (30): severity
    // stays dominant, and "also works on a second line" separates points that
    // would otherwise be indistinguishable.
    const axes = e.builds_on ? (e.builds_on.length - 1) * 8 : 0;
    // A point making two forcing threats wins; it belongs above a
    // single four (30) and below a five (50).
    // `shapes_on_two_lines` first kept legacy's 45, which put two blocked threes
    // above every real block of an open three (51010: ten of them ahead of the
    // only defending point). 12 keeps them above a plain building point and
    // below a block that leaves the opponent no four.
    const dual = e.double_threat ? 45 : e.shapes_on_two_lines ? (blockLeaves ? 12 : 45) : 0;
    // A point the opponent turns into a double threat has to be visible; left
    // unranked it sits below every quiet point that happens to build a two.
    const theirs2 = (e.white_would_make ?? e.black_would_make) ? 42 : 0;
    const w = build ? (build.includes("five") ? 50 : build.includes("open four") ? 40
      : build.includes("four") ? 30 : build.includes("open three") ? 20 : 10) : 0;
    // Same severity: a diagonal shape sorts ahead of a horizontal or vertical one.
    // +1 cannot pass the next severity (open three 20, four 30).
    const dirBonus = withDirection && build?.includes("diagonal") ? 1 : 0;
    // Blocking a four (their five next move) outranks making a plain four (30).
    // A three: dead line 27, no four left 25, a four left 12.
    // Severity of the threat first, `leaves` only within it: killing a blocked
    // three (not urgent) must never outrank any block of an open three. The
    // first version scored both 27 and lost 51006 / 51010 / 51016 that way.
    const open3 = block?.startsWith("open three");
    const d = !block ? 0
      : !blockLeaves ? (block.startsWith("four") ? 25 : 15)
      : block.startsWith("four") ? 35
      : !open3 ? 8
      : e.leaves === "this line can no longer make five" ? 27
      : partial ? 18 : 25;
    return both + w + d + axes + dual + theirs2 + dirBonus;
  };
  const nearestOwn = (label: string) => {
    const i = fromLabel(label, size);
    const c = i % size, r = Math.floor(i / size);
    let best = size;
    for (let k = 0; k < board.length; k++) {
      if (board[k] !== me) continue;
      const d = Math.max(Math.abs((k % size) - c), Math.abs(Math.floor(k / size) - r));
      if (d < best) best = d;
    }
    return best;
  };
  // Equal shapes: the adjacent extension comes before a jump. A gap three and
  // the stone next to the pair otherwise tie, and the jump was listed first.
  return out.sort((a, b) => score(b) - score(a) || nearestOwn(a.point) - nearestOwn(b.point)).slice(0, 24);
}
