/**
 * How many of Jev's black losses are things a `for` loop would have prevented?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-forced.ts [games]
 *
 * This sizes the ONE lever that is guaranteed to raise the win rate — a Layer 0
 * tactical backstop — before anyone pays its cost, which is the difficulty dial
 * AGENTS.md is built around. At every Jev move, code independently works out
 * whether the position was forced, then compares what Jev actually played:
 *
 *   win_now      Jev could make five. Did it?
 *   must_block   the opponent completes five next move. Did Jev take the point?
 *   must_answer  the opponent wins soon (open four / 四三 / VCF). Did Jev
 *                play one of the points that defuses it — or a winning attack
 *                of its own, which is also correct and is counted separately?
 *
 * A miss rate near zero means the losses are strategic and a backstop buys
 * nothing. The plain candidate-set version of this is what "入门" and "標準"
 * mean in AGENTS.md, so the number decides a product question, not a tuning one.
 */
import { type Board, type Player, createBoard, applyMove, emptyCells, isWinningMove, toLabel } from "../lib/board";
import { makeRng, opponentMove, winningReplies } from "../lib/opponent";
import { nakedJevMove, PRIORITY_INITIATIVE } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const JEV: Player = 1;
const FOE: Player = 2;
/** Pass `key` to run with the `<colour>_would_make` field on, same seeds. */
const KEY = process.argv.includes("key");

function fivePoints(b: Board, p: Player): number[] {
  return emptyCells(b).filter((i) => isWinningMove(applyMove(b, i, p), S, i));
}

type Tally = { seen: number; missed: number; countered: number };
const t = {
  win_now: { seen: 0, missed: 0, countered: 0 } as Tally,
  must_block: { seen: 0, missed: 0, countered: 0 } as Tally,
  must_answer: { seen: 0, missed: 0, countered: 0 } as Tally,
};
const misses: string[] = [];

async function playGame(seed: number) {
  const rng = makeRng(seed);
  let board = createBoard(S);
  const history: Array<{ move: string; player: Player }> = [];
  let jevToMove = true;

  for (let ply = 0; ply < S * S; ply++) {
    if (emptyCells(board).length === 0) return "draw";
    if (jevToMove) {
      // What the position demands, worked out before Jev is asked.
      const mine = fivePoints(board, JEV);
      const theirs = fivePoints(board, FOE);
      const danger = mine.length || theirs.length ? [] : winningReplies(board, S, FOE, JEV);
      const safe = danger.length
        ? danger.filter((d) => winningReplies(applyMove(board, d, JEV), S, FOE, JEV).length === 0)
        : [];
      // Jev's own key points: moves that win for Jev whatever the opponent does.
      const ownWins = danger.length ? winningReplies(board, S, JEV, FOE) : [];

      const r = await nakedJevMove({
        board, size: S, jev: JEV, history, informed: true, priority: PRIORITY_INITIATIVE,
        keyPoints: KEY,
      });

      if (mine.length) {
        t.win_now.seen++;
        if (!mine.includes(r.moveIdx)) {
          t.win_now.missed++;
          misses.push(`win_now: had ${mine.map((i) => toLabel(i, S)).join("/")}, played ${r.move}`);
        }
      } else if (theirs.length) {
        t.must_block.seen++;
        if (!theirs.includes(r.moveIdx)) {
          t.must_block.missed++;
          misses.push(`must_block: had to take ${theirs.map((i) => toLabel(i, S)).join("/")}, played ${r.move}`);
        }
      } else if (safe.length) {
        // Only counted when a defusing move actually existed — otherwise the
        // position was already lost and there is nothing to miss.
        t.must_answer.seen++;
        if (!safe.includes(r.moveIdx)) {
          // Answering is not the only correct reply: Jev's own winning attack
          // (an open four, a 四三, the first stone of a VCF) beats defending.
          // The first version of this audit scored those as misses; on the
          // logged human games that turned 5 real misses into 12.
          if (ownWins.includes(r.moveIdx)) {
            t.must_answer.countered++;
          } else {
            t.must_answer.missed++;
            misses.push(`must_answer: ${safe.map((i) => toLabel(i, S)).join("/")} defused it, played ${r.move}`);
          }
        }
      }

      board = applyMove(board, r.moveIdx, JEV);
      history.push({ move: r.move, player: JEV });
      if (isWinningMove(board, S, r.moveIdx)) return "jev";
    } else {
      const i = opponentMove(board, S, FOE, 3, rng);
      board = applyMove(board, i, FOE);
      history.push({ move: toLabel(i, S), player: FOE });
      if (isWinningMove(board, S, i)) return "opponent";
    }
    jevToMove = !jevToMove;
  }
  return "draw";
}

async function main() {
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  const games = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8);
  console.log(`forced-move audit · ${games} games · Jev black vs L3 · keyPoints ${KEY ? "ON" : "off"} · ${activeTransport()}\n`);
  let w = 0, l = 0;
  for (let g = 0; g < games; g++) {
    const r = await playGame(9000 + 100 + g); // the screen's seeds, replayed
    if (r === "jev") w++; else if (r === "opponent") l++;
    process.stdout.write(r === "jev" ? "W" : r === "opponent" ? "L" : "-");
  }
  console.log(`  ${w}-${l}\n`);
  for (const [k, v] of Object.entries(t)) {
    console.log(`  ${k.padEnd(12)} arose ${String(v.seen).padStart(3)}   missed ${String(v.missed).padStart(3)}` +
      `   ${v.seen ? ((100 * v.missed) / v.seen).toFixed(0) + "%" : "—"}` +
      (v.countered ? `   (+${v.countered} answered with Jev's own winning attack)` : ""));
  }
  if (misses.length) {
    console.log(`\n  every miss:`);
    for (const m of misses.slice(0, 25)) console.log(`    ${m}`);
  }
}
main();
