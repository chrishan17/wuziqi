/**
 * Baseline probe for "naked Jev".
 *
 *   npx tsx scripts/probe.ts            # full run: limits -> tactics -> self-play
 *   npx tsx scripts/probe.ts limits     # only: how many options does the API accept?
 *   npx tsx scripts/probe.ts tactics    # only: 4 hand-made positions with known answers
 *   npx tsx scripts/probe.ts selfplay   # only: Jev vs random, logs every move
 *
 * Needs AI_GATEWAY_API_KEY in the environment.
 * Every move is appended to runs/probe-<timestamp>.jsonl.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import {
  type Board,
  type Player,
  applyMove,
  createBoard,
  emptyCells,
  fromLabel,
  isWinningMove,
  renderAscii,
  toLabel,
} from "../lib/board";
import { nakedJevMove, type MoveTrace } from "../lib/jev";
import { activeTransport, describeMissingKey, transportWarnings } from "../lib/transport";

const SIZE = Number(process.env.BOARD_SIZE ?? 15);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
let LOG_PATH = "";

function log(record: Record<string, unknown>) {
  if (!LOG_PATH) {
    mkdirSync("runs", { recursive: true });
    LOG_PATH = `runs/probe-${RUN_ID}.jsonl`;
  }
  appendFileSync(LOG_PATH, JSON.stringify({ ts: Date.now(), ...record }) + "\n");
}

function place(board: Board, labels: string[], player: Player, size: number): Board {
  let b = board;
  for (const l of labels) {
    const i = fromLabel(l, size);
    if (i < 0) throw new Error(`bad label ${l}`);
    b = applyMove(b, i, player);
  }
  return b;
}

function fmtTop(trace: MoveTrace, n = 5) {
  return trace.topMoves.slice(0, n).map((m) => `${m.label} ${(m.p * 100).toFixed(1)}%`).join("  ");
}

// ---------------------------------------------------------------- 1. limits
// The open question: does a choice question accept 225 options?
async function probeLimits() {
  console.log("\n=== 1. OPTION-COUNT LIMIT ===");
  console.log("Does a choice question accept every empty point on the board?\n");

  for (const size of [SIZE, 9, 7]) {
    const board = createBoard(size);
    const centre = Math.floor((size * size) / 2);
    const withOneStone = applyMove(board, centre, 1);
    const options = emptyCells(withOneStone).length;
    process.stdout.write(`  ${size}x${size} board -> ${options} options ... `);
    try {
      const t = await nakedJevMove({ board: withOneStone, size, jev: 2, history: [toLabel(centre, size)] });
      console.log(`OK  move=${t.move}  ${t.latencyMs}ms  in=${t.usage?.inputTokens ?? "?"}tok`);
      log({ phase: "limits", size, options, ok: true, trace: t });
      if (size === SIZE) return { workingSize: size, options };
      return { workingSize: size, options };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      console.log(`FAILED`);
      console.log(`     ${err?.name ?? "Error"}: ${msg}`);
      if (err?.responseBody) console.log(`     body: ${String(err.responseBody).slice(0, 400)}`);
      log({ phase: "limits", size, options, ok: false, error: msg });
      if (/credit card|billing|payment|quota|insufficient/i.test(msg)) {
        // An account-level rejection says nothing about option counts, and the
        // next two board sizes would print the identical message.
        console.log(
          "\n  This is an account/billing rejection, not an option-count limit.\n" +
            "  Nothing about Jev has been measured. Fix billing, or set\n" +
            "  JEV_TRANSPORT=native with TYPESAFE_API_KEY to bypass Vercel entirely.",
        );
        return null;
      }
    }
  }
  return null;
}

// --------------------------------------------------------------- 2. tactics
// Positions where the correct move is not a matter of taste. If naked Jev
// misses these, it cannot play gomoku unaided, and we know it in four calls.
const TACTICS: Array<{ name: string; black: string[]; white: string[]; jev: Player; correct: string[]; why: string }> = [
  {
    name: "win-now",
    black: ["H8", "H9", "H10", "H11"],
    white: ["D4", "E5", "F6", "M13"],
    jev: 1,
    correct: ["H7", "H12"],
    why: "black has four in a row and must simply complete five",
  },
  {
    name: "block-or-lose",
    black: ["H8", "H9", "H10", "H11"],
    white: ["D4", "E5", "F6"],
    jev: 2,
    correct: ["H7", "H12"],
    why: "black threatens five next move; white must block an open end",
  },
  {
    name: "block-open-three",
    black: ["H8", "H9", "H10"],
    white: ["D4", "E5"],
    jev: 2,
    correct: ["H7", "H11"],
    why: "an open three becomes an open four unless blocked now",
  },
  {
    name: "win-beats-block",
    black: ["C3", "C4", "C5", "C6"],
    white: ["H8", "H9", "H10", "H11"],
    jev: 2,
    correct: ["H7", "H12"],
    why: "white wins immediately; blocking black instead loses the game",
  },
];

async function probeTactics() {
  console.log("\n=== 2. FORCED TACTICS ===");
  console.log("Positions with a known correct answer. No hints given.\n");
  let passed = 0;
  for (const t of TACTICS) {
    let board = createBoard(SIZE);
    board = place(board, t.black, 1, SIZE);
    board = place(board, t.white, 2, SIZE);
    // Interleave so the stated move order is at least a legal alternation.
    const history = t.black.flatMap((bl, i) =>
      t.white[i] ? [{ move: bl, player: 1 as Player }, { move: t.white[i], player: 2 as Player }]
                 : [{ move: bl, player: 1 as Player }],
    ).concat(t.white.slice(t.black.length).map((w) => ({ move: w, player: 2 as Player })));
    process.stdout.write(`  ${t.name.padEnd(18)} `);
    try {
      const trace = await nakedJevMove({ board, size: SIZE, jev: t.jev, history });
      const ok = t.correct.includes(trace.move);
      if (ok) passed++;
      const p = trace.probabilities[trace.move] ?? 0;
      console.log(
        `${ok ? "PASS" : "FAIL"}  played ${trace.move} (${(p * 100).toFixed(1)}%)  want ${t.correct.join(" or ")}`,
      );
      console.log(`  ${" ".repeat(18)} top: ${fmtTop(trace)}`);
      console.log(`  ${" ".repeat(18)} threat=${trace.opponentThreat?.toFixed(2) ?? "?"} ${t.why}`);
      log({ phase: "tactics", case: t.name, expected: t.correct, ok, trace });
    } catch (err: any) {
      console.log(`ERROR ${err?.message ?? err}`);
      log({ phase: "tactics", case: t.name, error: String(err?.message ?? err) });
    }
  }
  console.log(`\n  tactics passed: ${passed}/${TACTICS.length}`);
  return { passed, total: TACTICS.length };
}

// -------------------------------------------------------------- 3. selfplay
// Jev vs a random legal mover. Losing this would be damning; winning it
// proves very little. The point is the move log, not the result.
async function probeSelfPlay(maxPlies = 40) {
  console.log("\n=== 3. JEV vs RANDOM ===");
  console.log("Jev plays black and moves first. Opponent plays uniformly at random.\n");

  let board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  let predictionHits = 0;
  let predictionAttempts = 0;
  let pendingPrediction: string | null = null;

  for (let ply = 0; ply < maxPlies; ply++) {
    const jevTurn = ply % 2 === 0;
    if (jevTurn) {
      let trace: MoveTrace;
      try {
        trace = await nakedJevMove({ board, size: SIZE, jev: 1, history });
      } catch (err: any) {
        console.log(`  ply ${ply}: ERROR ${err?.message ?? err}`);
        log({ phase: "selfplay", ply, error: String(err?.message ?? err) });
        return;
      }
      board = applyMove(board, trace.moveIdx, 1);
      history.push({ move: trace.move, player: 1 });
      console.log(
        `  ply ${String(ply).padStart(2)} JEV   ${trace.move.padEnd(4)} ` +
          `p=${((trace.probabilities[trace.move] ?? 0) * 100).toFixed(1)}%  ` +
          `pos=${trace.position?.score.toFixed(2) ?? "?"}  ` +
          `threat=${trace.opponentThreat?.toFixed(2) ?? "?"}  ${trace.latencyMs}ms`,
      );
      console.log(`         top: ${fmtTop(trace)}`);
      if (trace.predictedReply) {
        console.log(`         predicts opponent plays ${trace.predictedReply}`);
        pendingPrediction = trace.predictedReply;
      }
      log({ phase: "selfplay", ply, actor: "jev", trace, history: history.slice() });
      if (isWinningMove(board, SIZE, trace.moveIdx)) {
        console.log(`\n  Jev wins on ply ${ply}.`);
        break;
      }
    } else {
      const empties = emptyCells(board);
      const idx = empties[Math.floor(Math.random() * empties.length)];
      const label = toLabel(idx, SIZE);
      board = applyMove(board, idx, 2);
      history.push({ move: label, player: 2 });
      if (pendingPrediction) {
        predictionAttempts++;
        const hit = pendingPrediction === label;
        if (hit) predictionHits++;
        console.log(`  ply ${String(ply).padStart(2)} RAND  ${label.padEnd(4)} (prediction ${hit ? "HIT" : "miss"})`);
        log({ phase: "selfplay", ply, actor: "random", move: label, predicted: pendingPrediction, hit });
        pendingPrediction = null;
      } else {
        console.log(`  ply ${String(ply).padStart(2)} RAND  ${label}`);
        log({ phase: "selfplay", ply, actor: "random", move: label });
      }
      if (isWinningMove(board, SIZE, idx)) {
        console.log(`\n  Random opponent wins on ply ${ply}. That is a bad sign.`);
        break;
      }
    }
  }

  console.log("\n" + renderAscii(board, SIZE));
  if (predictionAttempts > 0) {
    // Against a random opponent the baseline is 1/empties, so this number is
    // only a smoke test. The real comparison needs a human or an engine.
    console.log(
      `\n  prediction vs random opponent: ${predictionHits}/${predictionAttempts} ` +
        `(chance is about ${(100 / emptyCells(board).length).toFixed(2)}% per guess)`,
    );
  }
}

async function main() {
  const mode = process.argv[2] ?? "all";
  const transport = activeTransport();
  for (const w of transportWarnings()) console.warn(`warning: ${w}`);
  const missing = describeMissingKey(transport);
  if (missing) {
    console.error(`${missing}\n`);
    console.error("Set JEV_TRANSPORT=native with TYPESAFE_API_KEY to bypass the Vercel gateway.");
    process.exit(1);
  }
  console.log(`board ${SIZE}x${SIZE}   transport ${transport}`);

  if (transport === "gateway") {
    try {
      const r = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
        headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
      });
      const c = (await r.json()) as { balance?: string; total_used?: string };
      console.log(`credits      balance ${c.balance ?? "?"}   used ${c.total_used ?? "?"}`);
      if (r.ok && c.balance === "0" && c.total_used === "0") {
        console.log(
          "             balance is 0 — if requests fail on billing, the card is either\n" +
            "             missing or on a different Vercel team than this key.",
        );
      }
    } catch {
      /* preflight only; the real calls below report their own errors */
    }
  }

  if (mode === "all" || mode === "limits") {
    const limits = await probeLimits();
    if (!limits) {
      console.error(`\nNo board size accepted the full option set. Nothing further to test.`);
      if (LOG_PATH) console.log(`full trace: ${LOG_PATH}`);
      process.exit(1);
    }
    if (limits.workingSize !== SIZE) {
      // The fixtures below use 15x15 coordinates; running them at another size
      // would just print parse errors and bury the result that matters.
      console.error(
        `\n${SIZE}x${SIZE} was rejected but ${limits.workingSize}x${limits.workingSize} ` +
          `(${limits.options} options) worked.\n` +
          `That is the headline answer: option count is the binding limit.\n` +
          `Re-run the rest with:  BOARD_SIZE=${limits.workingSize} npm run probe tactics`,
      );
      if (LOG_PATH) console.log(`\nfull trace: ${LOG_PATH}`);
      return;
    }
  }
  if (mode === "all" || mode === "tactics") await probeTactics();
  if (mode === "all" || mode === "selfplay") await probeSelfPlay();

  if (LOG_PATH) console.log(`\nfull trace: ${LOG_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
