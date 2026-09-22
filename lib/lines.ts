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

import { type Board, type Player, applyMove, toLabel } from "./board";

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
  /**
   * A three is live only when one of its critical points makes an open four
   * (two ways to five). Two nearby empties are not enough: a stone just
   * outside the 5-cell window can block one end, and `XX.X` then reads as an
   * open three while both follow-ups are single-point fours.
   * A four is live when it has two completion points.
   */
  live: boolean;
  note: string;
};

const LABEL: Record<Player, "black (X)" | "white (O)"> = {
  1: "black (X)",
  2: "white (O)",
};

export const DIR_VEC: Record<string, readonly [number, number]> = {
  horizontal: [1, 0],
  vertical: [0, 1],
  "diagonal down-right": [1, 1],
  "diagonal up-right": [1, -1],
};

function runLength(board: Board, size: number, idx: number, dx: number, dy: number): number {
  const p = board[idx];
  const c0 = idx % size, r0 = Math.floor(idx / size);
  let n = 1;
  for (const sign of [1, -1] as const) {
    let c = c0 + dx * sign, r = r0 + dy * sign;
    while (c >= 0 && c < size && r >= 0 && r < size && board[r * size + c] === p) {
      n++;
      c += dx * sign;
      r += dy * sign;
    }
  }
  return n;
}

/** Placing `emptyIdx` makes an open four along this line: two distinct ways to five. */
function makesOpenFour(board: Board, size: number, player: Player, dx: number, dy: number, emptyIdx: number): boolean {
  const placed = applyMove(board, emptyIdx, player);
  const c0 = emptyIdx % size, r0 = Math.floor(emptyIdx / size);
  let ways = 0;
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const c = c0 + dx * k, r = r0 + dy * k;
    if (c < 0 || c >= size || r < 0 || r >= size) continue;
    const i = r * size + c;
    if (placed[i] !== 0) continue;
    if (runLength(applyMove(placed, i, player), size, i, dx, dy) >= 5) ways++;
    if (ways >= 2) return true;
  }
  return false;
}

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
    const [dx, dy] = DIR_VEC[a.dir];
    const live = a.n === 4
      ? crit.length >= 2
      : a.n === 3
        ? crit.some((e) => makesOpenFour(board, size, a.player, dx, dy, e))
        : false;
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
      const names = crit.map((i) => toLabel(i, size)).join(" or ");
      note = live
        ? `open three: playing ${names} makes an open four. It must be blocked now, because an open four can no longer be stopped.`
        : `three, blocked on one side: ${names || "no room"}${crit.length >= 2 ? ". Playing there makes a four with only one way to five" : ""}`;
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
      live,
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

/**
 * Contiguous runs whose every 5-cell window is mixed, because both ends are
 * an opponent stone or the edge. `enumerateThreats` drops those windows, so a
 * four capped at both ends disappears and the state reads as if the line was
 * never played. Not a threat: `critical_points` is empty and `live` is false.
 */
export function blockedRuns(board: Board, size: number): Threat[] {
  const out: Threat[] = [];
  for (const { d: [dx, dy], name } of DIRS) {
    const seen = new Set<number>();
    for (let i = 0; i < board.length; i++) {
      if (board[i] === 0 || seen.has(i)) continue;
      const player = board[i] as Player;
      const col = (n: number) => n % size;
      const row = (n: number) => Math.floor(n / size);
      let c = col(i), r = row(i);
      while (c - dx >= 0 && c - dx < size && r - dy >= 0 && r - dy < size && board[(r - dy) * size + (c - dx)] === player) {
        c -= dx; r -= dy;
      }
      const stones: number[] = [];
      while (c >= 0 && c < size && r >= 0 && r < size && board[r * size + c] === player) {
        const idx = r * size + c;
        seen.add(idx);
        stones.push(idx);
        c += dx; r += dy;
      }
      if (stones.length < 2) continue;
      const endBlocked = (cc: number, rr: number) =>
        cc < 0 || cc >= size || rr < 0 || rr >= size || (board[rr * size + cc] !== 0 && board[rr * size + cc] !== player);
      const head = stones[0];
      const tail = stones[stones.length - 1];
      if (!endBlocked(col(head) - dx, row(head) - dy) || !endBlocked(col(tail) + dx, row(tail) + dy)) continue;
      const n = stones.length;
      out.push({
        player: LABEL[player],
        stones: stones.map((s) => toLabel(s, size)),
        direction: name,
        pattern: "blocked",
        severity: n >= 4 ? "four" : n === 3 ? "three" : "two",
        critical_points: [],
        live: false,
        note: `${n} in a row on the ${name} line, both ends blocked. This line cannot grow.`,
      });
    }
  }
  return out;
}

/**
 * Cross-colour relationships between stones — the opening's missing structure.
 *
 * `enumerateThreats` only reports windows containing ONE colour, so a board with
 * one black stone and one white stone yields nothing at all: measured, Jev's
 * second move as black sees `lines_on_board: 0` and `point_effects: 0`, i.e. the
 * bare coordinate list that scored 0/12 on forced moves. As white it gets
 * structure a ply earlier, free, from the opponent's stones.
 *
 * This states the relationships a single-colour window cannot: which stones of
 * OPPOSITE colour share a line, in which direction, how far apart, and whether
 * anything sits between them. Facts about the position; no move is named.
 *
 * Deliberately opening-only (`maxStones`) — once shapes exist, `lines_on_board`
 * and `point_effects` carry the position and adding this would be dilution, the
 * failure mode that cost this project 100% -> 60% accuracy once already.
 */
export function stoneRelations(board: Board, size: number, maxStones = 6) {
  const stones: Array<{ i: number; p: Player }> = [];
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) stones.push({ i, p: board[i] as Player });
  if (stones.length === 0 || stones.length > maxStones) return null;

  const name = (p: Player) => (p === 1 ? "black (X)" : "white (O)");
  const out: Array<Record<string, unknown>> = [];
  for (let a = 0; a < stones.length; a++) {
    for (let b = a + 1; b < stones.length; b++) {
      if (stones[a].p === stones[b].p) continue; // same colour is already in lines_on_board
      const ca = stones[a].i % size, ra = Math.floor(stones[a].i / size);
      const cb = stones[b].i % size, rb = Math.floor(stones[b].i / size);
      const dc = cb - ca, dr = rb - ra;
      let dir: string | null = null;
      if (dr === 0) dir = "horizontal";
      else if (dc === 0) dir = "vertical";
      else if (dc === dr) dir = "diagonal down-right";
      else if (dc === -dr) dir = "diagonal up-right";
      if (!dir) continue;
      const distance = Math.max(Math.abs(dc), Math.abs(dr));
      if (distance > 4) continue; // beyond five-in-a-row reach, so not a relationship
      out.push({
        stones: [toLabel(stones[a].i, size), toLabel(stones[b].i, size)],
        players: [name(stones[a].p), name(stones[b].p)],
        direction: dir,
        distance,
        note: `${toLabel(stones[b].i, size)} sits ${distance} point${distance > 1 ? "s" : ""} from ${toLabel(stones[a].i, size)} along the ${dir} line, so neither can make five through the other on it.`,
      });
    }
  }
  return out.length ? out : null;
}

/**
 * Opening fact for a straight line versus a diagonal step off it.
 *
 * A diagonal pair branches into more live twos than a straight pair, and one
 * opposing stone often cannot block both; a straight pair often can. Only
 * emitted while `player` has 1–3 stones and those stones are not already on a
 * diagonal. Names the points. Draws no conclusion about which to play.
 */
export function diagonalOpening(board: Board, size: number, player: Player) {
  const own: number[] = [];
  const foe: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === player) own.push(i);
    else if (board[i] !== 0) foe.push(i);
  }
  if (own.length === 0 || own.length >= 4) return null;

  const col = (i: number) => i % size;
  const row = (i: number) => Math.floor(i / size);
  const axisOf = (dc: number, dr: number): "h" | "v" | "d" | null => {
    if (dc === 0 && dr === 0) return null;
    if (dr === 0) return "h";
    if (dc === 0) return "v";
    if (Math.abs(dc) === Math.abs(dr)) return "d";
    return null;
  };

  let kind: "h" | "v" | "d" | null = null;
  let refDc = 0, refDr = 0;
  if (own.length === 1) {
    let near: number | null = null;
    let bestC = Infinity, bestM = Infinity;
    for (const f of foe) {
      const dc = Math.abs(col(f) - col(own[0])), dr = Math.abs(row(f) - row(own[0]));
      const cheb = Math.max(dc, dr), man = dc + dr;
      if (cheb < bestC || (cheb === bestC && (man < bestM || (man === bestM && f < (near ?? Infinity))))) {
        near = f; bestC = cheb; bestM = man;
      }
    }
    if (near !== null) {
      refDc = col(near) - col(own[0]);
      refDr = row(near) - row(own[0]);
      kind = axisOf(refDc, refDr);
    }
  } else {
    refDc = col(own[1]) - col(own[0]);
    refDr = row(own[1]) - row(own[0]);
    kind = axisOf(refDc, refDr);
    if (kind) {
      for (const p of own.slice(2)) {
        const dc = col(p) - col(own[0]), dr = row(p) - row(own[0]);
        if (axisOf(dc, dr) !== kind || refDc * dr !== refDr * dc) { kind = null; break; }
      }
    }
  }
  // Already a diagonal pair: developing it is the diagonal, so this fact is absent.
  if (own.length >= 2 && kind === "d") return null;
  if (own.length >= 2 && kind !== "h" && kind !== "v") return null;

  const onStraight = (i: number) => {
    if (kind !== "h" && kind !== "v") return false;
    for (const a of own) {
      const dc = col(i) - col(a), dr = row(i) - row(a);
      if (kind === "h" && dr === 0 && dc !== 0) return true;
      if (kind === "v" && dc === 0 && dr !== 0) return true;
    }
    return false;
  };
  const nearOwn = (i: number, max: number) => own.some((a) => {
    const d = Math.max(Math.abs(col(i) - col(a)), Math.abs(row(i) - row(a)));
    return d > 0 && d <= max;
  });

  const diagonal = new Set<string>();
  const straight = new Set<string>();
  for (const a of own) {
    for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
      if (dc === 0 && dr === 0) continue;
      const c = col(a) + dc, r = row(a) + dr;
      if (c < 0 || c >= size || r < 0 || r >= size) continue;
      const i = r * size + c;
      if (board[i] !== 0 || !nearOwn(i, 2)) continue;
      const label = toLabel(i, size);
      const diagStep = dc !== 0 && dr !== 0 && Math.abs(dc) === 1 && Math.abs(dr) === 1;
      if (diagStep && !onStraight(i)) diagonal.add(label);
      else if ((kind === "h" || kind === "v") && onStraight(i)) straight.add(label);
      else if ((kind === null || kind === "d") && (dc === 0 || dr === 0) && Math.max(Math.abs(dc), Math.abs(dr)) === 1) {
        straight.add(label);
      }
    }
  }
  if (diagonal.size === 0) return null;
  const your_line = kind === "h" ? "horizontal" : kind === "v" ? "vertical" : "none";
  return {
    your_line,
    diagonal_off_that_line: [...diagonal].sort(),
    straight_extensions: [...straight].sort(),
    note: your_line === "none"
      ? "diagonal_off_that_line are the empty diagonal neighbours of your stone. A diagonal pair branches into more live twos than a straight pair, and one opposing stone often cannot block both. straight_extensions are the orthogonal neighbours, which only start a straight pair."
      : "diagonal_off_that_line step diagonally off your straight line. A diagonal pair branches into more live twos than lengthening that straight line, and one opposing stone often cannot block both. straight_extensions only lengthen the straight line.",
  };
}

export type DiagonalBranch = {
  point: string;
  direction: "diagonal down-right" | "diagonal up-right";
  beside: string;
};

/** Whether a diagonal run can still take a stone. `blocked` means every end is an opponent stone or the edge. */
function diagonalRoom(board: Board, size: number, own: number[]): "none" | "open" | "blocked" {
  const col = (i: number) => i % size;
  const row = (i: number) => Math.floor(i / size);
  let any = false;
  let open = false;
  for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
    const groups = new Map<number, number[]>();
    for (const i of own) {
      const key = dx === dy ? col(i) - row(i) : col(i) + row(i);
      const g = groups.get(key);
      if (g) g.push(i);
      else groups.set(key, [i]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      any = true;
      const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
      g.sort((a, b) => (col(a) - col(b)) * dx + (row(a) - row(b)) * dy);
      const ends: Array<[number, number]> = [[g[0], -1], [g[g.length - 1], 1]];
      for (const [e, outward] of ends) {
        const c = col(e) + dx * outward, r = row(e) + dy * outward;
        if (c >= 0 && c < size && r >= 0 && r < size && board[r * size + c] === 0) open = true;
      }
      for (let k = 0; k < g.length - 1; k++) {
        const dc = col(g[k + 1]) - col(g[k]);
        if (Math.abs(dc) <= 1) continue;
        const c = col(g[k]) + dx * sign(dc);
        const r = row(g[k]) + dy * sign(row(g[k + 1]) - row(g[k]));
        if (board[r * size + c] === 0) open = true;
      }
    }
  }
  if (!any) return "none";
  return open ? "open" : "blocked";
}

/**
 * Diagonal steps off a horizontal or vertical line, for the whole game.
 *
 * `point_effects` starts at threes, so a diagonal neighbour that only makes a
 * two never appears, while the straight extension is listed as an open three.
 * These points are that missing two. A point that is also orthogonally adjacent
 * to one of your stones is left out — that shoulder continues a straight line.
 *
 * Present with one stone: the empty diagonal neighbours, so the second stone
 * starts a diagonal. There is no open three yet, so this does not outrank one.
 * Present with a straight pair that has not yet stepped onto a diagonal.
 * Absent once two of your stones share a diagonal (the open three on it comes
 * first), when the board is empty, or when a four can be made or must be blocked.
 * Names the points. Draws no conclusion about which to play.
 */
export function diagonalBranches(board: Board, size: number, player: Player): { points: DiagonalBranch[]; note: string } | null {
  const own: number[] = [];
  const foe: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === player) own.push(i);
    else if (board[i] !== 0) foe.push(i);
  }
  if (own.length === 0 && foe.length === 0) return null;

  const col = (i: number) => i % size;
  const row = (i: number) => Math.floor(i / size);
  let blockedDiag = false;
  // One stone has no open three to make. Listing its diagonal neighbours is
  // how the second stone leaves the orthogonal line. A straight pair keeps the
  // list until it steps onto a diagonal. A diagonal that can still grow is
  // absent here, because extending it is the open three. A diagonal blocked on
  // both ends cannot grow, and the windows that would describe it are mixed, so
  // it never appears in `lines_on_board` either — the list comes back as the
  // other diagonal.
  if (own.length >= 2) {
    const room = diagonalRoom(board, size, own);
    let ortho = false;
    for (let a = 0; a < own.length && !ortho; a++) {
      for (let b = a + 1; b < own.length; b++) {
        const dc = col(own[b]) - col(own[a]);
        const dr = row(own[b]) - row(own[a]);
        const ad = Math.max(Math.abs(dc), Math.abs(dr));
        if (ad === 0 || ad > 4) continue;
        if (dc === 0 || dr === 0) ortho = true;
      }
    }
    if (room === "open") return null;
    if (room === "none" && !ortho) return null;
    blockedDiag = room === "blocked";
  }

  const anchors = own.length > 0 ? own : foe;

  const foeName = player === 1 ? "white" : "black";
  const meName = player === 1 ? "black" : "white";
  for (const t of enumerateThreats(board, size, 4)) {
    if (t.player.startsWith(foeName) && (t.severity === "four" || t.severity === "five")) return null;
  }
  if (own.length >= 3) {
    const seen = new Set<number>();
    for (const a of own) {
      for (let dc = -2; dc <= 2; dc++) {
        for (let dr = -2; dr <= 2; dr++) {
          if (dc === 0 && dr === 0) continue;
          const c = col(a) + dc, r = row(a) + dr;
          if (c < 0 || c >= size || r < 0 || r >= size) continue;
          const i = r * size + c;
          if (board[i] !== 0 || seen.has(i)) continue;
          seen.add(i);
          const after = applyMove(board, i, player);
          const lab = toLabel(i, size);
          for (const t of enumerateThreats(after, size, 4)) {
            if (!t.player.startsWith(meName) || !t.stones.includes(lab)) continue;
            if (t.severity === "four" || t.severity === "five") return null;
          }
        }
      }
    }
  }

  const orthoTouch = (i: number) => anchors.some((a) => {
    const dc = col(i) - col(a), dr = row(i) - row(a);
    return (dc === 0 || dr === 0) && Math.max(Math.abs(dc), Math.abs(dr)) === 1;
  });
  const mid = (size - 1) / 2;
  type Cand = { i: number; direction: DiagonalBranch["direction"]; beside: string[]; centre: number };
  const byPoint = new Map<number, Cand>();
  for (const a of anchors) {
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const c = col(a) + dc, r = row(a) + dr;
      if (c < 0 || c >= size || r < 0 || r >= size) continue;
      const i = r * size + c;
      if (board[i] !== 0 || orthoTouch(i)) continue;
      const direction: DiagonalBranch["direction"] = dc === dr ? "diagonal down-right" : "diagonal up-right";
      const prev = byPoint.get(i);
      const beside = toLabel(a, size);
      if (prev) {
        if (!prev.beside.includes(beside)) prev.beside.push(beside);
      } else {
        byPoint.set(i, { i, direction, beside: [beside], centre: Math.abs(c - mid) + Math.abs(r - mid) });
      }
    }
  }
  const points = [...byPoint.values()]
    .sort((a, b) => b.beside.length - a.beside.length || a.centre - b.centre || a.i - b.i)
    .slice(0, 4)
    .map((p) => ({ point: toLabel(p.i, size), direction: p.direction, beside: p.beside.join("+") }));
  if (points.length === 0) return null;
  return {
    points,
    note: blockedDiag
      ? "The diagonal in `lines_on_board` with no critical points is blocked on both ends and cannot grow. These points start the other diagonal. Orthogonal neighbours, including a point that only sits between two opponent stones, are not listed."
      : own.length === 0
      ? "Diagonal neighbours of the opponent's stone. The orthogonal neighbours are not listed. There is no open three of yours yet."
      : "King-adjacent diagonal steps off your stones, and not the orthogonal neighbours. Each starts a two on a diagonal. They are absent from `point_effects`, which starts at threes. An open three is a stronger shape and is played first when one exists. This list is absent once two of your stones already share a diagonal, and absent when a four can be made or must be blocked.",
  };
}
