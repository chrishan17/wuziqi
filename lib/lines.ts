// Threat enumeration by sliding 5-cell windows.
//
// An earlier version walked CONTIGUOUS runs only, which made every split shape
// invisible: `XX.XX` — a four that wins on the next move — was reported as two
// "open two"s. Humans play with gaps constantly, so that blinded the model to
// most real threats. Windows are the correct primitive: five in a row must fall
// inside some 5-cell window, so a window containing only one colour plus empties
// is exactly a live threat.
//
// This is STATE, not candidate filtering: it describes relationships already
// present in the position. The option set stays every empty point.

import { type Board, type Player, toLabel } from "./board";

const DIRS = [
  { d: [1, 0] as const, name: "horizontal" },
  { d: [0, 1] as const, name: "vertical" },
  { d: [1, 1] as const, name: "diagonal down-right" },
  { d: [1, -1] as const, name: "diagonal up-right" },
];

export type Threat = {
  player: "black (X)" | "white (O)";
  stones: string[];
  direction: string;
  pattern: string;
  severity: "five" | "four" | "three" | "two";
  critical_points: string[];
  note: string;
};

const LABEL: Record<Player, "black (X)" | "white (O)"> = {
  1: "black (X)",
  2: "white (O)",
};

/**
 * Every 5-cell window that contains stones of exactly one player plus empties.
 * Windows are merged per (player, direction, stone-set) so the same shape is not
 * reported twice.
 */
export function enumerateThreats(board: Board, size: number, minStones = 2): Threat[] {
  // `crit` holds only ACTIONABLE points. For a four that is any empty in the
  // window (each completes five). For a shorter shape it is the empties within
  // one cell of the stones' span — the immediate extension/blocking points.
  // Including far-out cells dilutes the signal: an open three reported with four
  // candidate points instead of two dropped forced-move accuracy from 100% to 60%.
  type Acc = { stones: number[]; dir: string; player: Player; crit: Set<number>; n: number; pattern: string };
  const byKey = new Map<string, Acc>();

  for (const { d: [dx, dy], name } of DIRS) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cells: number[] = [];
        let ok = true;
        for (let k = 0; k < 5; k++) {
          const cc = c + dx * k, rr = r + dy * k;
          if (cc < 0 || cc >= size || rr < 0 || rr >= size) { ok = false; break; }
          cells.push(rr * size + cc);
        }
        if (!ok) continue;

        let player: Player | 0 = 0;
        let mixed = false;
        for (const i of cells) {
          const v = board[i];
          if (v === 0) continue;
          if (player === 0) player = v as Player;
          else if (player !== v) { mixed = true; break; }
        }
        if (mixed || player === 0) continue;

        const stones = cells.filter((i) => board[i] === player);
        if (stones.length < minStones) continue;
        const empties = cells.filter((i) => board[i] === 0);

        const pattern = cells
          .map((i) => (board[i] === 0 ? "." : board[i] === 1 ? "X" : "O"))
          .join("");

        // Position along the direction, used to bound "near the stones".
        const pos = (i: number) => (dx !== 0 ? i % size : Math.floor(i / size));
        const sp = stones.map(pos);
        const lo = Math.min(...sp), hi = Math.max(...sp);
        const actionable = stones.length >= 4
          ? empties
          : empties.filter((e) => pos(e) >= lo - 1 && pos(e) <= hi + 1);

        const key = `${player}:${name}:${stones.join(",")}`;
        const prev = byKey.get(key);
        if (prev) {
          for (const e of actionable) prev.crit.add(e);
        } else {
          byKey.set(key, {
            stones, dir: name, player, n: stones.length,
            crit: new Set(actionable),
            pattern,
          });
        }
      }
    }
  }

  // A four's critical point is the single empty in its own window. Collect those
  // separately so "two ways to make five" reads as unstoppable.
  const fourPoints = new Map<Player, Set<number>>([[1, new Set()], [2, new Set()]]);
  for (const a of byKey.values()) {
    if (a.n === 4) for (const e of a.crit) fourPoints.get(a.player)!.add(e);
  }

  const out: Threat[] = [];
  for (const a of byKey.values()) {
    const crit = [...a.crit].sort((x, y) => x - y);
    let severity: Threat["severity"];
    let note: string;

    if (a.n >= 5) {
      severity = "five";
      note = "five in a row — this player has already won";
    } else if (a.n === 4) {
      severity = "four";
      const many = fourPoints.get(a.player)!.size >= 2;
      note = many
        ? `four with more than one way to complete five — blocking one point is not enough`
        : `four: playing ${crit.map((i) => toLabel(i, size)).join(" or ")} makes five immediately`;
    } else if (a.n === 3) {
      severity = "three";
      note = crit.length >= 2
        ? `open three: playing ${crit.map((i) => toLabel(i, size)).join(" or ")} makes a four. It must be blocked now, because an open four can no longer be stopped.`
        : `three, blocked on one side: ${crit.map((i) => toLabel(i, size)).join(" or ") || "no room"}`;
    } else {
      severity = "two";
      note = "two with room to grow";
    }

    out.push({
      player: LABEL[a.player],
      stones: a.stones.map((i) => toLabel(i, size)),
      direction: a.dir,
      pattern: a.pattern,
      severity,
      critical_points: crit.map((i) => toLabel(i, size)),
      note,
    });
  }

  const rank = { five: 0, four: 1, three: 2, two: 3 };
  return out.sort(
    (x, y) => rank[x.severity] - rank[y.severity] || y.critical_points.length - x.critical_points.length,
  );
}

/** Back-compat name used by lib/jev.ts. */
export const enumerateLines = enumerateThreats;
export type Line = Threat;
