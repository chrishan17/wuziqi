/**
 * How hard can we make it before Jev stops winning?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ladder.ts [games] [maxLevel]
 *
 * Two knobs, both raising difficulty FOR Jev:
 *   - opponent level:  0 random, 1 greedy (takes wins, blocks fives), 2 threat-aware
 *   - handicap:        the opponent starts with N stones already on the board
 *
 * Climbs a column until Jev loses 2 of N, then moves on. Prints each cell as it
 * finishes so there is something to read before the whole run ends.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import {
  type Board, type Player,
  applyMove, createBoard, emptyCells, isWinningMove, renderAscii, toLabel,
} from "../lib/board";
import { type Level, LEVEL_NAMES, makeRng, opponentMove, placeHandicap } from "../lib/opponent";
import { nakedJevMove } from "../lib/jev";
import { activeTransport, describeMissingKey, transportWarnings } from "../lib/transport";

const SIZE = Number(process.env.BOARD_SIZE ?? 15);
const INFORMED = process.env.JEV_INFORMED === "1";
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
function log(r: Record<string, unknown>) {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/ladder-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
}

type Outcome = { winner: "jev" | "opponent" | "draw"; plies: number; reason?: string };

async function playGame(level: Level, handicap: number, seed: number): Promise<Outcome> {
  const rng = makeRng(seed);
  const JEV: Player = 2;      // Jev always plays white
  const OPP: Player = 1;      // opponent is black and opens

  let board = createBoard(SIZE);
  const history: Array<{ move: string; player: Player }> = [];
  if (handicap > 0) {
    board = placeHandicap(board, SIZE, OPP, handicap);
    for (let i = 0; i < board.length; i++) {
      if (board[i] === OPP) history.push({ move: toLabel(i, SIZE), player: OPP });
    }
    // Handicap stones already gave the opponent its opening; Jev moves first.
  }

  let jevTurn = handicap > 0;
  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    if (emptyCells(board).length === 0) return { winner: "draw", plies: ply };

    if (jevTurn) {
      let idx: number, label: string;
      try {
        const t = await nakedJevMove({ board, size: SIZE, jev: JEV, history, informed: INFORMED });
        idx = t.moveIdx; label = t.move;
        log({ kind: "move", level, handicap, seed, ply, actor: "jev", trace: t });
      } catch (e: any) {
        return { winner: "opponent", plies: ply, reason: `jev error: ${e?.message ?? e}` };
      }
      board = applyMove(board, idx, JEV);
      history.push({ move: label, player: JEV });
      if (isWinningMove(board, SIZE, idx)) return { winner: "jev", plies: ply };
    } else {
      const idx = opponentMove(board, SIZE, OPP, level, rng);
      board = applyMove(board, idx, OPP);
      history.push({ move: toLabel(idx, SIZE), player: OPP });
      if (isWinningMove(board, SIZE, idx)) return { winner: "opponent", plies: ply };
    }
    jevTurn = !jevTurn;
  }
  return { winner: "draw", plies: SIZE * SIZE };
}

async function main() {
  const games = Number(process.argv[2] ?? 3);
  const maxLevel = Number(process.argv[3] ?? 2) as Level;

  for (const w of transportWarnings()) console.warn(`warning: ${w}`);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }

  console.log(`ladder · ${SIZE}x${SIZE} · ${games} games per cell · transport ${activeTransport()} · convention ${INFORMED ? "informed" : "naked"}`);
  console.log(`Jev plays white. Opponent opens, and with a handicap starts N stones ahead.\n`);

  const table: string[] = [];
  for (let level = 0 as Level; level <= maxLevel; level = (level + 1) as Level) {
    for (let handicap = 0; handicap <= 4; handicap++) {
      let jw = 0, ow = 0, dr = 0;
      const plies: number[] = [];
      process.stdout.write(
        `  L${level} ${LEVEL_NAMES[level].padEnd(7)} handicap ${handicap}  `,
      );
      for (let g = 0; g < games; g++) {
        const r = await playGame(level, handicap, 7000 + level * 100 + handicap * 10 + g);
        if (r.winner === "jev") jw++;
        else if (r.winner === "opponent") ow++;
        else dr++;
        plies.push(r.plies);
        process.stdout.write(r.winner === "jev" ? "W" : r.winner === "draw" ? "-" : "L");
        log({ kind: "game", level, handicap, game: g, ...r });
      }
      const avg = Math.round(plies.reduce((a, b) => a + b, 0) / plies.length);
      console.log(`   ${jw}W ${ow}L ${dr}D   avg ${avg} plies`);
      table.push(`| L${level} ${LEVEL_NAMES[level]} | ${handicap} | ${jw}W ${ow}L ${dr}D | ${avg} |`);

      if (ow >= Math.ceil(games * 2 / 3)) {
        console.log(`     -> Jev stops winning here. Next opponent level.\n`);
        break;
      }
    }
  }

  console.log("\n| opponent | handicap | Jev result | avg plies |");
  console.log("| --- | --- | --- | --- |");
  for (const r of table) console.log(r);
  if (LOG) console.log(`\nfull trace: ${LOG}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
