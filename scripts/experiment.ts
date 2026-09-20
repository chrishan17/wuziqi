/**
 * Is the weak play Jev's, or my calling convention's?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/experiment.ts [repeats]
 *
 * Four conventions, same model, same 220-option choice, same positions —
 * every one taken from a game the naked baseline actually lost:
 *
 *   V0 naked     what the baseline sends today
 *   V1 policy    + an explicit gomoku priority order in the instructions
 *   V2 lines     + enumerated lines on the board (relationships) in the state
 *   V3 both
 *
 * The option set NEVER changes: all empty points, descriptions null. V2 adds
 * facts about the position, it does not pre-select candidates.
 */
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { type Board, type Player, emptyCells, renderAscii, stonesOf, toLabel } from "../lib/board";
import { enumerateLines } from "../lib/lines";
import { callJev, type Question, activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const POSITIONS = "/private/tmp/claude-501/-Users-chrishan-Dev-playground-wuziqi/0f701cbf-63e4-4058-9a43-a5d2e8af3c88/scratchpad/forced.json";
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
let LOG = "";
function log(r: Record<string, unknown>) {
  if (!LOG) { mkdirSync("runs", { recursive: true }); LOG = `runs/experiment-${RUN}.jsonl`; }
  appendFileSync(LOG, JSON.stringify({ ts: Date.now(), ...r }) + "\n");
}

const PRIORITY = [
  "1. If you can place a stone that makes five in a row, play it and win immediately.",
  "2. Otherwise, if the opponent would make five on their next move, take that point to block it.",
  "3. Otherwise, if the opponent has four in a row with an open end, block that end.",
  "4. Otherwise, if the opponent has three in a row with both ends open, block one end now. Left alone it becomes an open four, which can no longer be stopped.",
  "5. Otherwise, extend your own longest line that still has open ends.",
  "Defending against a line that is about to become unstoppable takes priority over building your own shorter line.",
];

type Variant = "V0 naked" | "V1 policy" | "V2 lines" | "V3 both";

function build(board: Board, variant: Variant) {
  const jev: Player = 2;
  const withLines = variant === "V2 lines" || variant === "V3 both";
  const withPolicy = variant === "V1 policy" || variant === "V3 both";

  const state: Record<string, unknown> = {
    game: "Gomoku (five-in-a-row), free-style rules, no forbidden moves",
    board_size: `${S}x${S}`,
    coordinates:
      `Columns are letters A-O from left to right. Rows are numbers 1-${S} from top to bottom.`,
    win_condition:
      "A player wins immediately by getting five or more of their own stones in an unbroken line, horizontally, vertically, or diagonally.",
    you_play: "white (O)",
    opponent_plays: "black (X)",
    board_diagram: renderAscii(board, S),
    black_stones: stonesOf(board, S, 1),
    white_stones: stonesOf(board, S, 2),
  };
  if (withLines) {
    state.lines_on_board = enumerateLines(board, S, 2);
    state.lines_note =
      "Every run of two or more stones already on the board, longest first, with the empty points at each end.";
  }

  const instructions: Record<string, unknown> = {
    task: "You are playing white (O) in this game of gomoku. Choose the point where you will place your next stone.",
    goal: "Play the strongest move: make your own five-in-a-row while stopping black (X) from making theirs.",
    options: "Every option is an empty point on the board, written as column letter then row number.",
  };
  if (withPolicy) instructions.priority_order = PRIORITY;

  const criteria: Record<string, null> = {};
  for (const i of emptyCells(board)) criteria[toLabel(i, S)] = null;

  return {
    state,
    questions: { best_move: { type: "choice", instructions, criteria } } as unknown as Record<string, Question>,
  };
}

async function main() {
  const repeats = Number(process.argv[2] ?? 3);
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }

  const positions = JSON.parse(readFileSync(POSITIONS, "utf8")) as Array<{
    game: number; ply: number; board: Board; must: string[]; why: string; jevPlayed: string;
  }>;

  const variants: Variant[] = ["V0 naked", "V1 policy", "V2 lines", "V3 both"];
  const score: Record<string, { hit: number; total: number }> = {};
  for (const v of variants) score[v] = { hit: 0, total: 0 };

  console.log(`${positions.length} forced positions x ${variants.length} variants x ${repeats} runs`);
  console.log(`transport ${activeTransport()}\n`);

  for (const p of positions) {
    console.log(`  game ${p.game} ply ${p.ply} — must play ${p.must.join(" or ")}`);
    console.log(`    ${p.why}`);
    for (const v of variants) {
      const { state, questions } = build(p.board, v);
      const picks: string[] = [];
      let hits = 0;
      for (let k = 0; k < repeats; k++) {
        try {
          const r = await callJev({ state, questions });
          const a = r.answers.best_move as any;
          const ok = p.must.includes(a.choice);
          if (ok) hits++;
          const pr = a.probabilities?.[a.choice];
          picks.push(`${a.choice}${pr ? `(${(pr * 100).toFixed(0)}%)` : ""}${ok ? "✓" : ""}`);
          log({ position: `${p.game}/${p.ply}`, variant: v, run: k, pick: a.choice, ok, must: p.must,
                probabilities: a.probabilities });
        } catch (e: any) {
          picks.push(`ERR`);
          log({ position: `${p.game}/${p.ply}`, variant: v, run: k, error: String(e?.message ?? e) });
        }
      }
      score[v].hit += hits; score[v].total += repeats;
      console.log(`    ${v.padEnd(10)} ${hits}/${repeats}  ${picks.join(" ")}`);
    }
    console.log();
  }

  console.log("=== forced-move accuracy ===");
  for (const v of variants) {
    const s = score[v];
    const pct = ((s.hit / s.total) * 100).toFixed(0);
    console.log(`  ${v.padEnd(10)} ${String(s.hit).padStart(2)}/${s.total}  ${pct.padStart(3)}%  ${"#".repeat(Math.round(s.hit / s.total * 30))}`);
  }
  if (LOG) console.log(`\nfull trace: ${LOG}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
