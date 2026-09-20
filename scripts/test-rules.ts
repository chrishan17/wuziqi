import { createBoard, applyMove, fromLabel, toLabel, isWinningMove, renderAscii, emptyCells } from "../lib/board";
const S = 15;
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
// label roundtrip
ok("A1 -> 0", fromLabel("A1", S) === 0);
ok("O15 -> 224", fromLabel("O15", S) === 224);
ok("centre label", toLabel(Math.floor(225/2), S) === "H8", toLabel(112,S));
ok("roundtrip all", Array.from({length:225},(_,i)=>i).every(i=>fromLabel(toLabel(i,S),S)===i));
ok("reject offboard", fromLabel("P1", S) === -1 && fromLabel("A16", S) === -1);

// win detection
function build(labels: string[], p: 1|2) { let b = createBoard(S); for (const l of labels) b = applyMove(b, fromLabel(l,S), p); return b; }
let b = build(["H8","H9","H10","H11","H12"], 1);
ok("vertical five wins", isWinningMove(b, S, fromLabel("H12",S)));
b = build(["H8","H9","H10","H11"], 1);
ok("four does not win", !isWinningMove(b, S, fromLabel("H11",S)));
b = build(["C3","D3","E3","F3","G3"], 2);
ok("horizontal five wins", isWinningMove(b, S, fromLabel("G3",S)));
b = build(["C3","D4","E5","F6","G7"], 1);
ok("diagonal \\ wins", isWinningMove(b, S, fromLabel("G7",S)));
b = build(["G3","F4","E5","D6","C7"], 1);
ok("diagonal / wins", isWinningMove(b, S, fromLabel("C7",S)));
b = build(["A1","B1","C1","D1","E1"], 1);
ok("edge five wins", isWinningMove(b, S, fromLabel("E1",S)));
// no wrap-around across rows
b = build(["M1","N1","O1","A2","B2"], 1);
ok("no row wraparound", !isWinningMove(b, S, fromLabel("B2",S)));
// overline (6) counts in free-style
b = build(["C3","D3","E3","F3","G3","H3"], 1);
ok("overline counts (free-style)", isWinningMove(b, S, fromLabel("H3",S)));
// empties
ok("empty count", emptyCells(createBoard(S)).length === 225);

// verify probe fixtures have the claimed correct answers
console.log("\n  --- fixture verification ---");
const fixtures = [
  { name:"win-now", black:["H8","H9","H10","H11"], white:["D4","E5","F6","M13"], jev:1 as const, correct:["H7","H12"] },
  { name:"block-or-lose", black:["H8","H9","H10","H11"], white:["D4","E5","F6"], jev:2 as const, correct:["H7","H12"] },
  { name:"block-open-three", black:["H8","H9","H10"], white:["D4","E5"], jev:2 as const, correct:["H7","H11"] },
  { name:"win-beats-block", black:["C3","C4","C5","C6"], white:["H8","H9","H10","H11"], jev:2 as const, correct:["H7","H12"] },
];
for (const f of fixtures) {
  let bd = createBoard(S);
  for (const l of f.black) bd = applyMove(bd, fromLabel(l,S), 1);
  for (const l of f.white) bd = applyMove(bd, fromLabel(l,S), 2);
  // no overlap
  ok(`${f.name}: no overlapping stones`, new Set([...f.black,...f.white]).size === f.black.length+f.white.length);
  // correct squares empty
  ok(`${f.name}: answer squares empty`, f.correct.every(c=>bd[fromLabel(c,S)]===0));
  // for win-type fixtures, playing correct move must actually win
  if (f.name==="win-now" || f.name==="win-beats-block") {
    const res = f.correct.map(c=>isWinningMove(applyMove(bd, fromLabel(c,S), f.jev), S, fromLabel(c,S)));
    ok(`${f.name}: correct move actually wins`, res.every(Boolean), JSON.stringify(res));
  }
  // for block fixtures, NOT blocking must lose next turn
  if (f.name==="block-or-lose") {
    const res = f.correct.map(c=>isWinningMove(applyMove(bd, fromLabel(c,S), 1), S, fromLabel(c,S)));
    ok(`${f.name}: black wins there if unblocked`, res.every(Boolean));
  }
}
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
