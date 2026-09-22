/**
 * Powered A/B. Many games, run in parallel, results appended as they finish.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ab.ts [games] [concurrency]
 *
 * Why this exists rather than more `colour-check` runs: the control's true rate
 * against L3 is near 39%, and `colour-check`'s 12- and 24-game blocks came back
 * 8-4, 7-5 and 7-17 on the SAME arm. Separating 39% from 55% at 80% power needs
 * roughly 170 games per arm, which is an hour of wall clock unless the games run
 * concurrently.
 *
 * Three things this does that the smaller harness does not:
 *   - plays games through a worker pool, so the wall clock is divided
 *   - appends every finished game to runs/ab-<ts>.jsonl, so a run that dies
 *     halfway is still evidence and can be re-analysed
 *   - counts an API failure as `error`, NOT as a loss. colour-check scores an
 *     errored game to the opponent, which silently turns a 429 into a data point
 *
 * Arms are seeded identically, so read the paired net, not the raw records.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import {
  type Board, type Player,
  createBoard, applyMove, emptyCells, isWinningMove, toLabel,
} from "../lib/board";
import { makeRng, opponentMove } from "../lib/opponent";
import { nakedJevMove, PRIORITY_INITIATIVE, PRIORITY_LEAN, PRIORITY_KEY, PRIORITY_KEY_LEAVES } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";
import type { DoubleThreatMode } from "../lib/effects";

const S = 15;
const JEV: Player = 1;
const FOE: Player = 2;
const LEVEL = 3 as const;
const SEED_BASE = Number(process.env.SEED_BASE ?? 20000);

type Arm = { name: string; keyPoints?: boolean; doubleThreat?: DoubleThreatMode; ship?: boolean; ladder?: string[]; blockLeaves?: boolean; dropBlockedThreeBlocks?: boolean };
// `ship` is what app/api/move/route.ts sends for black: PRIORITY_LEAN,
// leanDiagonal and double_threat. `legacy` / `fixed` / `split` are the same
// config with each `DoubleThreatMode`, so they can run in one process, paired.
// `control`, `key` and `dual` predate that ladder.
// `splitkey` is `split` plus `<colour>_would_make`.
// `keyladder` is `splitkey` with PRIORITY_KEY instead of PRIORITY_LEAN.
// `keyleaves` adds `leaves` and PRIORITY_KEY_LEAVES; `nobb` also drops blocked-three blocks.
const SHIP_MODES: Record<string, DoubleThreatMode> = { ship: true, legacy: "legacy", fixed: "fixed", split: "split", splitkey: "split", keyladder: "split", keyleaves: "split", nobb: "split" };
const ARMS: Arm[] = (process.env.ARMS ?? "control,key,dual")
  .split(",")
  .map((n) => n in SHIP_MODES
    ? { name: n, doubleThreat: SHIP_MODES[n], ship: true, keyPoints: ["splitkey", "keyladder", "keyleaves", "nobb"].includes(n), ladder: n === "keyleaves" || n === "nobb" ? PRIORITY_KEY_LEAVES : n === "keyladder" ? PRIORITY_KEY : PRIORITY_LEAN, blockLeaves: n === "keyleaves" || n === "nobb", dropBlockedThreeBlocks: n === "nobb" }
    : { name: n, keyPoints: n === "key", doubleThreat: n === "dual" });

const RUN = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("runs", { recursive: true });
const LOG = `runs/ab-${RUN}.jsonl`;

type Outcome = "jev" | "opponent" | "draw" | "error";

/**
 * Every game's moves go into the log, so a discordant pair can be replayed and
 * the move where the arms diverged found. `p` is Jev's probability on the move
 * it played; null for the opponent.
 */
type Played = { outcome: Outcome; moves: Array<{ move: string; player: Player; p: number | null }> };

async function playGame(arm: Arm, seed: number): Promise<Played> {
  const moves: Played["moves"] = [];
  const outcome = await play(arm, seed, moves);
  return { outcome, moves };
}

async function play(arm: Arm, seed: number, moves: Played["moves"]): Promise<Outcome> {
  const rng = makeRng(seed);
  let board = createBoard(S);
  const history: Array<{ move: string; player: Player }> = [];
  let jevToMove = true;

  for (let ply = 0; ply < S * S; ply++) {
    if (emptyCells(board).length === 0) return "draw";
    if (jevToMove) {
      let t;
      try {
        t = await nakedJevMove({
          board, size: S, jev: JEV, history, informed: true,
          priority: arm.ladder ?? (arm.ship ? PRIORITY_LEAN : PRIORITY_INITIATIVE),
          leanDiagonal: arm.ship, blockLeaves: arm.blockLeaves, dropBlockedThreeBlocks: arm.dropBlockedThreeBlocks,
          keyPoints: arm.keyPoints, doubleThreat: arm.doubleThreat,
        });
      } catch {
        // Transport already retried. Losing the game here would be a made-up
        // data point, so the game is dropped from both arms instead.
        return "error";
      }
      board = applyMove(board, t.moveIdx, JEV);
      history.push({ move: t.move, player: JEV });
      moves.push({ move: t.move, player: JEV, p: Number((t.probabilities[t.move] ?? 0).toFixed(3)) });
      if (isWinningMove(board, S, t.moveIdx)) return "jev";
    } else {
      const i = opponentMove(board, S, FOE, LEVEL, rng);
      board = applyMove(board, i, FOE);
      history.push({ move: toLabel(i, S), player: FOE });
      moves.push({ move: toLabel(i, S), player: FOE, p: null });
      if (isWinningMove(board, S, i)) return "opponent";
    }
    jevToMove = !jevToMove;
  }
  return "draw";
}

/** Wilson score interval — an exact-ish CI that behaves at small n and near 0/1. */
function wilson(w: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = w / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

async function main() {
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  const games = Number(process.argv[2] ?? 170);
  const concurrency = Number(process.argv[3] ?? 6);

  console.log(
    `A/B · ${games} games/arm · ${ARMS.length} arms · concurrency ${concurrency} · ` +
      `seeds ${SEED_BASE}+ · L${LEVEL} · ${activeTransport()}`,
  );
  console.log(`  arms: ${ARMS.map((a) => a.name).join(", ")}   log: ${LOG}\n`);

  // One flat job list so every worker stays busy to the very end.
  const jobs: Array<{ arm: Arm; g: number }> = [];
  for (let g = 0; g < games; g++) for (const arm of ARMS) jobs.push({ arm, g });

  const results = new Map<string, Map<number, Outcome>>(ARMS.map((a) => [a.name, new Map()]));
  let done = 0;
  const started = Date.now();
  let next = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const j = next++;
        if (j >= jobs.length) return;
        const { arm, g } = jobs[j];
        const { outcome, moves } = await playGame(arm, SEED_BASE + g);
        results.get(arm.name)!.set(g, outcome);
        appendFileSync(LOG, JSON.stringify({
          arm: arm.name, game: g, seed: SEED_BASE + g, outcome, plies: moves.length, moves,
        }) + "\n");
        done++;
        if (done % 25 === 0 || done === jobs.length) {
          const secs = (Date.now() - started) / 1000;
          const eta = (secs / done) * (jobs.length - done);
          process.stdout.write(
            `  ${done}/${jobs.length} games · ${secs.toFixed(0)}s elapsed · ~${eta.toFixed(0)}s left\n`,
          );
        }
      }
    }),
  );

  console.log("");
  // Paired against `BASELINE` (default: control, else the first arm).
  const baseName = process.env.BASELINE ?? (results.has("control") ? "control" : ARMS[0].name);
  const ctl = results.get(baseName) ?? new Map<number, Outcome>();
  for (const arm of ARMS) {
    const r = results.get(arm.name)!;
    const w = [...r.values()].filter((o) => o === "jev").length;
    const l = [...r.values()].filter((o) => o === "opponent").length;
    const e = [...r.values()].filter((o) => o === "error").length;
    const [lo, hi] = wilson(w, w + l);
    let line = `  ${arm.name.padEnd(8)} ${String(w).padStart(3)}-${String(l).padEnd(3)} ` +
      `${((100 * w) / (w + l || 1)).toFixed(1)}%  95% CI [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]` +
      (e ? `  (${e} dropped to errors)` : "");
    if (arm.name !== baseName && ctl.size) {
      // Paired: only games where BOTH arms produced a real result.
      let won = 0, lost = 0;
      for (const [g, o] of r) {
        const c = ctl.get(g);
        if (!c || o === "error" || c === "error" || o === c) continue;
        if (o === "jev") won++; else if (c === "jev") lost++;
      }
      line += `   paired vs ${baseName}: won ${won} lost ${lost} net ${won - lost >= 0 ? "+" : ""}${won - lost}`;
    }
    console.log(line);
  }
  console.log(`\n  full log: ${LOG}`);
}
main();
