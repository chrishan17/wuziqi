/**
 * L3 acceptance. Pure TS, no network, no key.
 *
 *   npx tsx scripts/test-l3.ts [games]
 *
 * L3 only earns the right to be a ruler if it beats L2 from BOTH seats — a
 * ruler that is only stronger as black measures the seat, not the player. The
 * tactical assertions come first, because a match result cannot tell you which
 * of the three additions is actually firing.
 */
import {
  type Board, type Player,
  createBoard, applyMove, isWinningMove, emptyCells, fromLabel, toLabel,
} from "../lib/board";
import { type Level, makeRng, opponentMove } from "../lib/opponent";

const S = 15;
let failures = 0;
function expect(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  PASS ${name.padEnd(34)} ${detail}`);
  else { failures++; console.log(`  FAIL ${name.padEnd(34)} ${detail}`); }
}

function pos(black: string[], white: string[]): Board {
  const b = createBoard(S);
  for (const l of black) b[fromLabel(l, S)] = 1;
  for (const l of white) b[fromLabel(l, S)] = 2;
  return b;
}
const move = (b: Board, me: Player, lvl: Level, seed = 7) =>
  toLabel(opponentMove(b, S, me, lvl, makeRng(seed)), S);

console.log("L3 tactics\n");

// 1. Win now.
expect("takes the five",
  ["H4", "H9"].includes(move(pos(["H5", "H6", "H7", "H8"], ["A1", "B1", "C1"]), 1, 3)),
  move(pos(["H5", "H6", "H7", "H8"], ["A1", "B1", "C1"]), 1, 3));

// 2. Block their five.
expect("blocks their four",
  ["H4", "H9"].includes(move(pos(["H5", "H6", "H7", "H8"], ["A1", "B1", "C1"]), 2, 3)),
  move(pos(["H5", "H6", "H7", "H8"], ["A1", "B1", "C1"]), 2, 3));

// 3. Open four beats a plain four: both are "a four" to L2's weighting, only
//    one of them wins.
{
  const b = pos(["F8", "G8", "H8"], ["A1", "B2", "C3"]);
  const m = move(b, 1, 3);
  expect("prefers the open four", m === "E8" || m === "I8", `${m} (E8/I8 make .XXXX.)`);
}

// 4. 双三. Black has two separate twos crossing at F8; playing it makes two
//    open threes at once and cannot be answered. No single line of it is a
//    four, so this is the case VCF alone walks straight past — and it is the
//    case L2 cannot see at all, because its score is a MAX over lines and one
//    open three scores the same as two.
{
  const b = pos(["D8", "E8", "F6", "F7"], ["A1", "O15", "A15", "O1"]);
  const attack = move(b, 1, 3);
  expect("makes the double three", attack === "F8", `L3 ${attack} · L2 ${move(b, 1, 2)}`);
  const defend = move(b, 2, 3);
  expect("takes their double-three point", defend === "F8", `L3 ${defend} · L2 ${move(b, 2, 2)}`);
}

// 5. The veto: do not hand the opponent an open four.
{
  // white to move with nothing of its own; black has an open three that becomes
  // an open four unless white takes an end.
  const b = pos(["F8", "G8", "H8"], ["A1", "B2"]);
  const m = move(b, 2, 3);
  expect("answers an open three", m === "E8" || m === "I8", m);
}

console.log("\nL3 vs L2 — both seats, colours alternated\n");

function playGame(black: Level, white: Level, seed: number): 1 | 2 | 0 {
  const rng = makeRng(seed);
  let board = createBoard(S);
  for (let ply = 0; ply < S * S; ply++) {
    const me: Player = ply % 2 === 0 ? 1 : 2;
    if (emptyCells(board).length === 0) return 0;
    const idx = opponentMove(board, S, me, me === 1 ? black : white, rng);
    board = applyMove(board, idx, me);
    if (isWinningMove(board, S, idx)) return me;
  }
  return 0;
}

const games = Number(process.argv[2] ?? 12);
const t0 = Date.now();
let asBlack = 0, asWhite = 0, lostBlack = 0, lostWhite = 0, draws = 0;
for (let g = 0; g < games; g++) {
  const r1 = playGame(3, 2, 2000 + g);
  if (r1 === 1) asBlack++; else if (r1 === 2) lostBlack++; else draws++;
  const r2 = playGame(2, 3, 2000 + g);
  if (r2 === 2) asWhite++; else if (r2 === 1) lostWhite++; else draws++;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  L3 as black  ${asBlack}-${lostBlack}`);
console.log(`  L3 as white  ${asWhite}-${lostWhite}`);
console.log(`  draws ${draws} · ${games * 2} games in ${secs}s\n`);

expect("L3 > L2 as black", asBlack >= Math.ceil(games * 0.75), `${asBlack}/${games}`);
expect("L3 > L2 as white", asWhite >= Math.ceil(games * 0.75), `${asWhite}/${games}`);

console.log(`\n  ${failures === 0 ? "L3 is fit to be the ruler" : `${failures} failure(s)`}`);
process.exit(failures ? 1 : 0);
