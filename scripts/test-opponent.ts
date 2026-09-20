// The ladder is only meaningful if the ruler is monotone: L2 > L1 > L0.
// Pure TS, no network, no key.
import { type Player, createBoard, applyMove, isWinningMove, emptyCells } from "../lib/board";
import { type Level, LEVEL_NAMES, makeRng, opponentMove, placeHandicap } from "../lib/opponent";

const SIZE = 15;

function playGame(a: Level, b: Level, seed: number): 1 | 2 | 0 {
  const rng = makeRng(seed);
  let board = createBoard(SIZE);
  for (let ply = 0; ply < SIZE * SIZE; ply++) {
    const me: Player = ply % 2 === 0 ? 1 : 2;
    const lvl = me === 1 ? a : b;
    if (emptyCells(board).length === 0) return 0;
    const idx = opponentMove(board, SIZE, me, lvl, rng);
    board = applyMove(board, idx, me);
    if (isWinningMove(board, SIZE, idx)) return me;
  }
  return 0;
}

function match(a: Level, b: Level, games = 20) {
  let aw = 0, bw = 0, d = 0;
  for (let g = 0; g < games; g++) {
    // alternate colours so first-move advantage cancels
    const r = g % 2 === 0 ? playGame(a, b, 1000 + g) : playGame(b, a, 1000 + g);
    const winnerIsA = g % 2 === 0 ? r === 1 : r === 2;
    if (r === 0) d++; else if (winnerIsA) aw++; else bw++;
  }
  return { aw, bw, d };
}

let failures = 0;
function expect(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  PASS ${name.padEnd(28)} ${detail}`);
  else { failures++; console.log(`  FAIL ${name.padEnd(28)} ${detail}`); }
}

console.log("opponent ladder monotonicity (20 games each, colours alternated)\n");
const m10 = match(1, 0);
expect("L1 beats L0", m10.aw >= 18, `L1 ${m10.aw} - ${m10.bw} L0 (draws ${m10.d})`);
const m21 = match(2, 1);
expect("L2 beats L1", m21.aw >= 15, `L2 ${m21.aw} - ${m21.bw} L1 (draws ${m21.d})`);
const m20 = match(2, 0);
expect("L2 beats L0", m20.aw >= 19, `L2 ${m20.aw} - ${m20.bw} L0 (draws ${m20.d})`);

// handicap placement sanity
for (const n of [1, 2, 3, 4]) {
  const b = placeHandicap(createBoard(SIZE), SIZE, 1, n);
  expect(`handicap ${n} places ${n}`, b.filter((v) => v === 1).length === n, `${n} stones`);
}

console.log(`\n  ${failures === 0 ? "ruler is monotone" : `${failures} failure(s) — ladder would be meaningless`}`);
process.exit(failures ? 1 : 0);
