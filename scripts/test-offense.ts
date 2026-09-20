/**
 * Over a whole game, does white ever build its own attack?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-offense.ts [games]
 *
 * The single-threat test showed Jev picks the attacking block when there is
 * exactly one threat and one better answer. The complaint was about whole
 * games: white answers locally every move and never assembles a line. So this
 * measures the game, not the move.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type Board, type Player, createBoard, applyMove, emptyCells, isWinningMove, toLabel, renderAscii } from "../lib/board";
import { enumerateThreats } from "../lib/lines";
import { makeRng, opponentMove } from "../lib/opponent";
import { nakedJevMove } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
const log = (r: Record<string, unknown>) => {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/offense-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
};

const RANK: Record<string, number> = { five: 5, four: 4, three: 3, two: 2 };

/** Best shape white holds on the board right now. */
function whiteBest(b: Board): number {
  let best = 0;
  for (const t of enumerateThreats(b, S, 2)) {
    if (!t.player.startsWith("white")) continue;
    best = Math.max(best, RANK[t.severity] ?? 0);
  }
  return best;
}

type Result = {
  winner: string; plies: number;
  whitePeak: number;         // best shape white ever held
  whiteThreatMoves: number;  // moves after which white held a three or better
  blackPeak: number;
};

async function playGame(effects: boolean, seed: number): Promise<Result> {
  const rng = makeRng(seed);
  let board: Board = createBoard(S);
  const history: Array<{ move: string; player: Player }> = [];
  let whitePeak = 0, whiteThreatMoves = 0, blackPeak = 0;

  for (let ply = 0; ply < 80; ply++) {
    if (emptyCells(board).length === 0) return { winner: "draw", plies: ply, whitePeak, whiteThreatMoves, blackPeak };
    if (ply % 2 === 0) {
      const i = opponentMove(board, S, 1, 2, rng);
      board = applyMove(board, i, 1);
      history.push({ move: toLabel(i, S), player: 1 });
      if (isWinningMove(board, S, i)) return { winner: "opponent", plies: ply, whitePeak, whiteThreatMoves, blackPeak };
    } else {
      let t;
      try {
        // `bare` drops point_effects along with the other observation questions,
        // so the control keeps lines_on_board but loses "what a move creates".
        t = await nakedJevMove({ board, size: S, jev: 2, history, informed: true, noEffects: !effects });
      } catch (e: any) {
        return { winner: `error: ${e?.message ?? e}`, plies: ply, whitePeak, whiteThreatMoves, blackPeak };
      }
      board = applyMove(board, t.moveIdx, 2);
      history.push({ move: t.move, player: 2 });
      const w = whiteBest(board);
      whitePeak = Math.max(whitePeak, w);
      if (w >= 3) whiteThreatMoves++;
      log({ effects, seed, ply, move: t.move, whiteBest: w });
      if (isWinningMove(board, S, t.moveIdx)) return { winner: "jev", plies: ply, whitePeak, whiteThreatMoves, blackPeak };
    }
    for (const th of enumerateThreats(board, S, 2)) {
      if (th.player.startsWith("black")) blackPeak = Math.max(blackPeak, RANK[th.severity] ?? 0);
    }
  }
  return { winner: "draw", plies: 80, whitePeak, whiteThreatMoves, blackPeak };
}

const NAME = ["-", "-", "two", "three", "four", "five"];

async function main() {
  const games = Number(process.argv[2] ?? 3);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  console.log(`white's offence over full games · ${games} games per mode · vs L2 threat opponent\n`);

  for (const effects of [true, false]) {
    const rows: Result[] = [];
    console.log(`  ${effects ? "with point_effects" : "without (control)"}`);
    for (let g = 0; g < games; g++) {
      const r = await playGame(effects, 5000 + g);
      rows.push(r);
      console.log(`    game ${g}: ${r.winner.padEnd(9)} ${String(r.plies).padStart(2)} plies` +
        `   white peak ${NAME[r.whitePeak]}   moves holding a three+ ${r.whiteThreatMoves}`);
    }
    const w = rows.filter((r) => r.winner === "jev").length;
    const peak = (rows.reduce((a, r) => a + r.whitePeak, 0) / rows.length).toFixed(1);
    const thr = (rows.reduce((a, r) => a + r.whiteThreatMoves, 0) / rows.length).toFixed(1);
    console.log(`    -> wins ${w}/${games}   avg white peak ${peak}   avg moves with a three+ ${thr}\n`);
  }
  if (LOG) console.log(`full trace: ${LOG}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
