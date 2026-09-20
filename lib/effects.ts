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

import { type Board, type Player, applyMove, emptyCells, toLabel } from "./board";
import { enumerateThreats } from "./lines";

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
};

function keysFor(me: Player) {
  return me === 2
    ? { build: "for_white" as const, block: "blocks_black" as const }
    : { build: "for_black" as const, block: "blocks_white" as const };
}

/** What this point builds for the player the effects were computed for. */
export const mine = (e: PointEffect) => e.for_white ?? e.for_black;
/** Which opponent threat this point answers. */
export const theirs = (e: PointEffect) => e.blocks_black ?? e.blocks_white;

const RANK: Record<string, number> = { five: 5, four: 4, three: 3, two: 2 };

function severityPhrase(sev: string, openEnds: number): string {
  if (sev === "five") return "makes five — wins immediately";
  if (sev === "four") return openEnds >= 2 ? "makes an open four — unstoppable" : "makes a four";
  if (sev === "three") return openEnds >= 2 ? "makes an open three" : "makes a blocked three";
  return "extends to two";
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
): PointEffect[] {
  const foe: Player = me === 1 ? 2 : 1;
  const foeLabel = foe === 1 ? "black" : "white";
  const K = keysFor(me);

  // Opponent threats worth answering, and the points that answer them.
  const blockMap = new Map<string, string>();
  for (const t of enumerateThreats(board, size, 3)) {
    if (!t.player.startsWith(foeLabel)) continue;
    if (RANK[t.severity] < 3) continue;
    for (const p of t.critical_points) {
      const desc = `${t.severity} ${t.stones.join("-")} (${t.direction})`;
      const prev = blockMap.get(p);
      // keep the most severe threat this point answers
      if (!prev || RANK[t.severity] > RANK[prev.split(" ")[0]]) blockMap.set(p, desc);
    }
  }

  const out: PointEffect[] = [];
  for (const idx of nearby(board, size, 2)) {
    const label = toLabel(idx, size);
    const after = applyMove(board, idx, me);

    // best shape this point gives the player to move, and every direction it
    // builds in — the strongest alone cannot express a double threat.
    let best: { sev: string; ends: number } | null = null;
    const byDir = new Map<string, { sev: string; ends: number }>();
    for (const t of enumerateThreats(after, size, 2)) {
      if (t.player.startsWith(foeLabel)) continue;
      if (!t.stones.includes(label)) continue;
      if (!best || RANK[t.severity] > RANK[best.sev]) best = { sev: t.severity, ends: t.critical_points.length };
      const prev = byDir.get(t.direction);
      if (!prev || RANK[t.severity] > RANK[prev.sev]) {
        byDir.set(t.direction, { sev: t.severity, ends: t.critical_points.length });
      }
    }

    const blocks = blockMap.get(label);
    const makesSomething = best && RANK[best.sev] >= 3;
    // A point on two of your own lines is worth stating even when neither line
    // has reached a three yet — that is where a double threat starts.
    const multi = multiAxis && byDir.size >= 2;
    if (!makesSomething && !blocks && !multi) continue;

    out.push({
      point: label,
      ...(best && RANK[best.sev] >= 2 ? { [K.build]: severityPhrase(best.sev, best.ends) } : {}),
      ...(multi
        ? {
            builds_on: [...byDir]
              .sort((a, b2) => RANK[b2[1].sev] - RANK[a[1].sev])
              .map(([dir, v]) => `${severityPhrase(v.sev, v.ends)} (${dir})`),
          }
        : {}),
      ...(blocks ? { [K.block]: blocks } : {}),
    });
  }

  // Points doing both come first; then by what they build. Ordering is itself
  // information the model reads.
  const score = (e: PointEffect) => {
    const build = mine(e), block = theirs(e);
    const both = build && block ? 100 : 0;
    // Extra directions are a TIE-BREAKER, not a promotion. Weighted so a
    // triple-two (10 + 16 = 26) still ranks below a plain four (30): severity
    // stays dominant, and "also works on a second line" separates points that
    // would otherwise be indistinguishable.
    const axes = e.builds_on ? (e.builds_on.length - 1) * 8 : 0;
    const w = build ? (build.includes("five") ? 50 : build.includes("open four") ? 40
      : build.includes("four") ? 30 : build.includes("open three") ? 20 : 10) : 0;
    const d = block ? (block.startsWith("four") ? 25 : 15) : 0;
    return both + w + d + axes;
  };
  return out.sort((a, b) => score(b) - score(a)).slice(0, 24);
}
