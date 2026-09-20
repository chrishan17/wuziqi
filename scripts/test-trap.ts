/**
 * Does Jev exploit black's 禁手 when the facts are in front of it?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-trap.ts [repeats]
 *
 * Each position has a white move that black cannot answer, because the only
 * blocking point is forbidden for black. Run with and without the
 * `forbidden_analysis` state field to see whether the field is what moves Jev.
 * Nothing in the instructions mentions 禁手 strategy.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type Board, createBoard, applyMove, fromLabel, emptyCells, toLabel } from "../lib/board";
import { nakedJevMove } from "../lib/jev";
import { analyseForbidden } from "../lib/exploit";
import { RENJU, FREESTYLE, outcomeOf } from "../lib/renju";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
const log = (r: Record<string, unknown>) => {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/trap-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
};

function build(black: string[], white: string[]): Board {
  let b = createBoard(S);
  for (const l of black) b = applyMove(b, fromLabel(l, S), 1);
  for (const l of white) b = applyMove(b, fromLabel(l, S), 2);
  return b;
}

// STRICT fixtures: white's three is blocked on one side, so the trap move makes
// a SIMPLE four whose single completion point is black's 禁手. An open four
// would win with or without 禁手 and would measure nothing. Validated so that
// neither side already has a five, and no other white move makes an open four.
const CASES = [
  {
    name: "col C R",
    black: ["C1", "C2", "C3", "C4", "C6", "H5"],
    white: ["E5", "F5", "G5"],
  },
  {
    name: "col D R",
    black: ["D1", "D2", "D3", "D4", "D6", "I5"],
    white: ["F5", "G5", "H5"],
  },
  {
    name: "col E R",
    black: ["E1", "E2", "E3", "E4", "E6", "J5"],
    white: ["G5", "H5", "I5"],
  },
  {
    name: "col F L",
    black: ["F1", "F2", "F3", "F4", "F6", "A5"],
    white: ["D5", "C5", "B5"],
  },
  {
    name: "col F R",
    black: ["F1", "F2", "F3", "F4", "F6", "K5"],
    white: ["H5", "I5", "J5"],
  },
  {
    name: "col G L",
    black: ["G1", "G2", "G3", "G4", "G6", "B5"],
    white: ["E5", "D5", "C5"],
  },
];

async function main() {
  const repeats = Number(process.argv[2] ?? 3);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }

  console.log(`禁手 exploitation · ${repeats} runs per cell · transport ${activeTransport()}\n`);
  const score = { with: { hit: 0, n: 0 }, without: { hit: 0, n: 0 } };

  for (const c of CASES) {
    const board = build(c.black, c.white);
    const a = analyseForbidden(board, S, RENJU)!;
    const traps = a.white_moves_black_cannot_answer.map((x) => x.white_plays);
    if (traps.length === 0) { console.log(`  ${c.name}: no trap found, skipping`); continue; }
    // Guard: if black can just make five, blocking beats any trap and this
    // position measures nothing.
    const blackWins = emptyCells(board)
      .filter((i) => outcomeOf(board, S, i, 1, RENJU).kind === "win")
      .map((i) => toLabel(i, S));
    if (blackWins.length) {
      console.log(`  ${c.name}: INVALID — black wins at ${blackWins.join(",")}, skipping`);
      continue;
    }
    // If any other white move makes an open four, that wins regardless of 禁手
    // and this position cannot attribute Jev's choice to the forbidden rule.
    const openFourElsewhere = emptyCells(board).filter((m) => {
      if (traps.includes(toLabel(m, S))) return false;
      const nb = applyMove(board, m, 2);
      let n = 0;
      for (const p of emptyCells(nb)) {
        const nn = applyMove(nb, p, 2);
        const c2 = p % S, r2 = Math.floor(p / S);
        for (const [dx, dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
          let k = 1;
          for (const sg of [1,-1]) { let cc = c2+dx*sg, rr = r2+dy*sg;
            while (cc>=0&&cc<S&&rr>=0&&rr<S&&nn[rr*S+cc]===2) { k++; cc+=dx*sg; rr+=dy*sg; } }
          if (k >= 5) { n++; break; }
        }
        if (n >= 2) return true;
      }
      return false;
    });
    if (openFourElsewhere.length) {
      console.log(`  ${c.name}: INVALID — white wins anyway at ${openFourElsewhere.map(m=>toLabel(m,S)).join(",")}, skipping`);
      continue;
    }
    console.log(`  ${c.name}`);
    console.log(`    unanswerable white moves: ${traps.join(", ")}`);

    for (const mode of ["with", "without"] as const) {
      const picks: string[] = [];
      let hit = 0;
      for (let k = 0; k < repeats; k++) {
        try {
          // `without` passes free-style rules, so analyseForbidden returns null
          // and the state carries no forbidden_analysis at all.
          const t = await nakedJevMove({
            board, size: S, jev: 2, history: [],
            informed: true,
            rules: mode === "with" ? RENJU : FREESTYLE,
          });
          const good = traps.includes(t.move);
          if (good) hit++;
          picks.push(`${t.move}${good ? "✓" : ""}`);
          log({ case: c.name, mode, run: k, pick: t.move, traps, ok: good, probabilities: t.probabilities });
        } catch (e: any) { picks.push("ERR"); log({ case: c.name, mode, run: k, error: String(e?.message ?? e) }); }
      }
      score[mode].hit += hit; score[mode].n += repeats;
      const lbl = mode === "with" ? "with 禁手 facts   " : "without (control)";
      console.log(`    ${lbl} ${hit}/${repeats}  ${picks.join(" ")}`);
    }
    console.log();
  }

  console.log("=== takes the unanswerable move ===");
  for (const m of ["with", "without"] as const) {
    const s = score[m];
    const pct = s.n ? ((s.hit / s.n) * 100).toFixed(0) : "-";
    console.log(`  ${m === "with" ? "with 禁手 facts   " : "without (control)"} ${s.hit}/${s.n}  ${pct}%`);
  }
  if (LOG) console.log(`\nfull trace: ${LOG}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
