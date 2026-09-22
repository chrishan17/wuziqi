/**
 * Does `stone_relations` change what Jev plays in the opening?
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-opening.ts [positions]
 *
 * `black+open` came out 9-3 in the screen against a 7-5 control, but only +2 on
 * the paired discordant games — inside the noise. Before spending a bigger run
 * on it, check the mechanism rather than the scoreboard: the field is
 * opening-only, so if it does not change Jev's early MOVE it cannot be causing
 * anything, and a 9-3 record would be luck downstream.
 *
 * Each position is a real opening: Jev (black) at the centre, the L3 opponent's
 * reply, and Jev to move again — the exact ply where RESULTS.md measured
 * `lines_on_board: 0` and `point_effects: 0`.
 */
import { type Player, createBoard, applyMove, toLabel } from "../lib/board";
import { makeRng, opponentMove } from "../lib/opponent";
import { nakedJevMove, PRIORITY_INITIATIVE, buildState } from "../lib/jev";
import { activeTransport, describeMissingKey } from "../lib/transport";

const S = 15;
const JEV: Player = 1;

async function main() {
  const missing = describeMissingKey(activeTransport());
  if (missing) { console.error(missing); process.exit(1); }
  const n = Number(process.argv[2] ?? 8);
  console.log(`opening field check · ${n} positions · Jev black, 2nd move · ${activeTransport()}\n`);

  let differ = 0;
  const rows: string[] = [];
  for (let k = 0; k < n; k++) {
    // Jev opens at the centre (its own 98% prior), the opponent answers.
    let board = applyMove(createBoard(S), Math.floor((S * S) / 2), JEV);
    const reply = opponentMove(board, S, 2, 3, makeRng(4000 + k * 17));
    board = applyMove(board, reply, 2);
    const history = [
      { move: toLabel(Math.floor((S * S) / 2), S), player: JEV },
      { move: toLabel(reply, S), player: 2 as Player },
    ];

    const st: any = buildState(board, S, JEV, history, true, undefined, false, false, false, true);
    const common = { board, size: S, jev: JEV, history, informed: true, priority: PRIORITY_INITIATIVE };
    const [off, on] = await Promise.all([
      nakedJevMove({ ...common }),
      nakedJevMove({ ...common, openingRelations: true }),
    ]);
    const same = off.move === on.move;
    if (!same) differ++;
    rows.push(
      `  white ${toLabel(reply, S).padEnd(4)} lines ${String(st.lines_on_board.length)} effects ${String(st.point_effects.length)}` +
        ` relations ${String(st.stone_relations?.length ?? 0)}` +
        `   off ${off.move.padEnd(4)}(${off.topMoves[0].p.toFixed(2)})` +
        `  on ${on.move.padEnd(4)}(${on.topMoves[0].p.toFixed(2)})` +
        `  ${same ? "same" : "DIFFERENT"}`,
    );
  }
  console.log(rows.join("\n"));
  console.log(`\n  the field changed Jev's move in ${differ}/${n} openings.`);
  if (differ === 0) {
    console.log(`  => it cannot be the cause of anything downstream; the screen record was luck.`);
  }
}
main();
