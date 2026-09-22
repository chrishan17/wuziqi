/**
 * Is the second pass' signal any good?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-verify.ts [games]
 *
 * A 5-game scoreboard cannot answer this: the second pass only changes anything
 * on the moves where it SWITCHES, which is a handful per run. So judge the two
 * questions directly against a code-side ground truth, per candidate:
 *
 *   unanswerable  Jev says: after this move I have a threat white cannot fully
 *                 answer. Truth: after this move, play white's best L3 reply —
 *                 does Jev still have a winning point? (L3's check is one ply
 *                 deep, so this is a proxy, not an oracle.)
 *   refuted       Jev says: white now has a forcing win. Truth: white has a
 *                 point from which `winsSoon` holds.
 *
 * Reported as mean probability on the true cases vs the false ones. A question
 * that cannot separate them is noise, and `VERIFY_ALPHA` gives noise authority
 * over round one.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import {
  type Board, type Player,
  createBoard, applyMove, emptyCells, fromLabel, isWinningMove, toLabel,
} from "../lib/board";
import { makeRng, opponentMove, winningReplies } from "../lib/opponent";
import { nakedJevMove, PRIORITY_INITIATIVE } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const JEV: Player = 1;
const FOE: Player = 2;
const LEVEL = 3 as const;

const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
const log = (r: Record<string, unknown>) => {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/verify-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
};

/** Does Jev still hold a winning point after the opponent's best answer? */
function trulyUnanswerable(b: Board, rng: () => number): boolean {
  if (winningReplies(b, S, JEV, FOE).length === 0) return false;
  const reply = opponentMove(b, S, FOE, LEVEL, rng);
  return winningReplies(applyMove(b, reply, FOE), S, JEV, FOE).length > 0;
}
const trulyRefuted = (b: Board) => winningReplies(b, S, FOE, JEV).length > 0;

type Row = { q: "unanswerable" | "refuted"; p: number; truth: boolean };
const rows: Row[] = [];
let switches = 0, switchBetter = 0, switchWorse = 0, switchSame = 0;

async function playGame(seed: number) {
  const rng = makeRng(seed);
  let board = createBoard(S);
  const history: Array<{ move: string; player: Player }> = [];
  let jevToMove = true;

  for (let ply = 0; ply < S * S; ply++) {
    if (emptyCells(board).length === 0) return "draw";
    if (jevToMove) {
      const t = await nakedJevMove({
        board, size: S, jev: JEV, history, informed: true,
        priority: PRIORITY_INITIATIVE, verify: true,
      });
      if (t.verified) {
        // Ground-truth every candidate the second pass looked at.
        const judged = t.verified.map((v) => {
          const after = applyMove(board, fromLabel(v.label, S), JEV);
          const truthU = trulyUnanswerable(after, makeRng(seed + 1));
          const truthR = trulyRefuted(after);
          rows.push({ q: "unanswerable", p: v.unanswerable, truth: truthU });
          rows.push({ q: "refuted", p: v.refuted, truth: truthR });
          return { ...v, truthU, truthR };
        });
        if (t.verifySwitched) {
          switches++;
          // Round one's pick is the candidate with the highest p1.
          const one = judged.reduce((a, b) => (b.p1 > a.p1 ? b : a));
          const two = judged.find((c) => c.label === t.move)!;
          // Better = trades a refuted move for a safe one, or a quiet move for
          // a genuinely unanswerable one.
          const rank = (c: typeof one) => (c.truthR ? -1 : 0) + (c.truthU ? 1 : 0);
          const d = rank(two) - rank(one);
          if (d > 0) switchBetter++; else if (d < 0) switchWorse++; else switchSame++;
          log({ kind: "switch", from: one.label, to: two.label, judged });
        }
      }
      board = applyMove(board, t.moveIdx, JEV);
      history.push({ move: t.move, player: JEV });
      if (isWinningMove(board, S, t.moveIdx)) return "jev";
    } else {
      const i = opponentMove(board, S, FOE, LEVEL, rng);
      board = applyMove(board, i, FOE);
      history.push({ move: toLabel(i, S), player: FOE });
      if (isWinningMove(board, S, i)) return "opponent";
    }
    jevToMove = !jevToMove;
  }
  return "draw";
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function main() {
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  const games = Number(process.argv[2] ?? 4);
  console.log(`verify calibration · ${games} games · Jev black vs L${LEVEL} · ${activeTransport()}\n`);

  let w = 0, l = 0;
  for (let g = 0; g < games; g++) {
    const r = await playGame(5000 + g);
    if (r === "jev") w++; else if (r === "opponent") l++;
    process.stdout.write(r === "jev" ? "W" : r === "opponent" ? "L" : "-");
  }
  console.log(`  ${w}-${l}\n`);

  console.log("  question       n   P(said) when TRUE   when FALSE   separation");
  for (const q of ["unanswerable", "refuted"] as const) {
    const r = rows.filter((x) => x.q === q);
    const t = r.filter((x) => x.truth).map((x) => x.p);
    const f = r.filter((x) => !x.truth).map((x) => x.p);
    const sep = mean(t) - mean(f);
    console.log(
      `  ${q.padEnd(13)}${String(r.length).padStart(3)}` +
        `${(t.length ? mean(t).toFixed(3) : "  n/a").padStart(18)} (n=${t.length})` +
        `${(f.length ? mean(f).toFixed(3) : "  n/a").padStart(11)} (n=${f.length})` +
        `${(Number.isNaN(sep) ? "  n/a" : (sep >= 0 ? "+" : "") + sep.toFixed(3)).padStart(12)}`,
    );
  }
  console.log(`\n  switches: ${switches} (better ${switchBetter} · worse ${switchWorse} · same ${switchSame})`);
  console.log(`  ground truth is L3's one-ply check, so it is a proxy — read separation, not absolutes.`);
  if (LOG) console.log(`  every switch logged to ${LOG}`);
}
main();
