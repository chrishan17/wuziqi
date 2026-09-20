/**
 * Does Jev attack while it defends?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-dual.ts [repeats]
 *
 * Each position: black has an open three that must be answered. One blocking
 * point also builds white's own line; the other builds nothing. Both defend
 * equally, so picking the dual-purpose one is free value.
 *
 * Toggle is the `point_effects` state field, nothing else. No instruction
 * anywhere mentions balancing attack and defence.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type Board, createBoard, applyMove, fromLabel, toLabel, emptyCells } from "../lib/board";
import { nakedJevMove } from "../lib/jev";
import { pointEffects, mine, theirs } from "../lib/effects";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
const log = (r: Record<string, unknown>) => {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/dual-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
};

const DIRS = [[1,0],[0,1],[1,1],[1,-1]] as const;
function fiveAvailable(b: Board, p: 1 | 2): string[] {
  return emptyCells(b).filter((i) => {
    const nb = applyMove(b, i, p), c = i % S, r = Math.floor(i / S);
    for (const [dx, dy] of DIRS) {
      let n = 1;
      for (const s of [1,-1]) { let cc=c+dx*s, rr=r+dy*s;
        while (cc>=0&&cc<S&&rr>=0&&rr<S&&nb[rr*S+cc]===p) { n++; cc+=dx*s; rr+=dy*s; } }
      if (n >= 5) return true;
    }
    return false;
  }).map((i) => toLabel(i, S));
}

/**
 * Black gets an open three on a row: (brow, bcol..bcol+2).
 * White gets two stones stacked in the column of the LEFT blocking point, so
 * that blocking there also makes white a vertical open three.
 * The RIGHT blocking point defends just as well and builds nothing.
 */
function makeCase(brow: number, bcol: number) {
  const L = "ABCDEFGHIJKLMNO";
  const black = [0, 1, 2].map((k) => `${L[bcol + k]}${brow}`);
  const dualCol = L[bcol - 1];
  const white = [`${dualCol}${brow - 2}`, `${dualCol}${brow - 1}`];
  return { black, white };
}

const CASES = [
  { name: "black G-I row 8",  ...makeCase(8, 6) },
  { name: "black E-G row 6",  ...makeCase(6, 4) },
  { name: "black H-J row 11", ...makeCase(11, 7) },
  { name: "black D-F row 9",  ...makeCase(9, 3) },
  { name: "black I-K row 7",  ...makeCase(7, 8) },
  { name: "black F-H row 12", ...makeCase(12, 5) },
];

async function main() {
  const repeats = Number(process.argv[2] ?? 3);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`attack-while-defending · ${repeats} runs per cell · transport ${activeTransport()}\n`);

  const score = { with: { hit: 0, n: 0, blocked: 0 }, without: { hit: 0, n: 0, blocked: 0 } };

  for (const c of CASES) {
    let board: Board = createBoard(S);
    for (const l of c.black) board = applyMove(board, fromLabel(l, S), 1);
    for (const l of c.white) board = applyMove(board, fromLabel(l, S), 2);

    if (fiveAvailable(board, 1).length || fiveAvailable(board, 2).length) {
      console.log(`  ${c.name}: INVALID — a five is already available, skipping`); continue;
    }
    const eff = pointEffects(board, S);
    const dual = eff.filter((e) => mine(e) && theirs(e)).map((e) => e.point);
    const blockOnly = eff.filter((e) => !mine(e) && theirs(e)).map((e) => e.point);
    if (dual.length === 0 || blockOnly.length === 0) {
      console.log(`  ${c.name}: INVALID — needs both a dual point and a block-only point, skipping`); continue;
    }
    const allBlocks = [...dual, ...blockOnly];
    console.log(`  ${c.name}`);
    console.log(`    dual-purpose blocks: ${dual.join(",")}   block-only: ${blockOnly.join(",")}`);

    for (const mode of ["with", "without"] as const) {
      const picks: string[] = [];
      let hit = 0, blocked = 0;
      for (let k = 0; k < repeats; k++) {
        try {
          const t = await nakedJevMove({ board, size: S, jev: 2, history: [], informed: true, bare: mode === "without" });
          const isDual = dual.includes(t.move);
          const isBlock = allBlocks.includes(t.move);
          if (isDual) hit++;
          if (isBlock) blocked++;
          picks.push(`${t.move}${isDual ? "★" : isBlock ? "·" : ""}`);
          log({ case: c.name, mode, run: k, pick: t.move, dual, blockOnly, isDual, isBlock });
        } catch (e: any) { picks.push("ERR"); log({ case: c.name, mode, error: String(e?.message ?? e) }); }
      }
      score[mode].hit += hit; score[mode].n += repeats; score[mode].blocked += blocked;
      console.log(`    ${mode === "with" ? "with point_effects" : "without (bare)   "} dual ${hit}/${repeats}  blocked ${blocked}/${repeats}  ${picks.join(" ")}`);
    }
    console.log();
  }

  console.log("=== picks the block that also attacks ===");
  for (const m of ["with", "without"] as const) {
    const s = score[m];
    if (!s.n) continue;
    console.log(`  ${m === "with" ? "with point_effects" : "without (bare)   "} dual ${s.hit}/${s.n} (${((s.hit/s.n)*100).toFixed(0)}%)   defended at all ${s.blocked}/${s.n}`);
  }
  if (LOG) console.log(`\nfull trace: ${LOG}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
