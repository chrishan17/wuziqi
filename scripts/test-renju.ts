// 禁手 judgement. These fixtures are the ones implementations get wrong:
// 五連優先, 四三 (legal) vs 四四 (forbidden), blocked threes, white immunity.
import { type Board, type Player, createBoard, applyMove, fromLabel, toLabel } from "../lib/board";
import { outcomeOf, forbiddenPoints, RENJU, FREESTYLE, countFours, countOpenThrees, type Rules } from "../lib/renju";

const S = 15;
let fail = 0;

function build(black: string[], white: string[] = []): Board {
  let b = createBoard(S);
  for (const l of black) b = applyMove(b, fromLabel(l, S), 1);
  for (const l of white) b = applyMove(b, fromLabel(l, S), 2);
  return b;
}

function check(
  name: string,
  opts: { black?: string[]; white?: string[]; play: string; by?: Player; rules?: Rules },
  want: "win" | "none" | "doubleThree" | "doubleFour" | "overline",
) {
  const b = build(opts.black ?? [], opts.white ?? []);
  const o = outcomeOf(b, S, fromLabel(opts.play, S), opts.by ?? 1, opts.rules ?? RENJU);
  const got = o.kind === "forbidden" ? o.rule : o.kind;
  if (got === want) console.log(`  PASS ${name.padEnd(40)} ${got}`);
  else { fail++; console.log(`  FAIL ${name.padEnd(40)} got ${got}, want ${want}`); }
}

console.log("禁手 judgement\n");

// ── 長連 ──────────────────────────────────────────────────
check("black exactly five wins", { black: ["H8","H9","H10","H11"], play: "H12" }, "win");
check("black six = 長連 forbidden", { black: ["H8","H9","H10","H11","H13"], play: "H12" }, "overline");
check("black seven = 長連 forbidden", { black: ["H7","H8","H9","H10","H12","H13"], play: "H11" }, "overline");
check("長連 off -> six wins (free-style)",
  { black: ["H8","H9","H10","H11","H13"], play: "H12", rules: FREESTYLE }, "win");
check("WHITE six in a row wins", { white: ["H8","H9","H10","H11","H13"], play: "H12", by: 2 }, "win");

// ── 五連優先 ──────────────────────────────────────────────
// Completing five also crosses another three: five takes priority.
check("five wins even while crossing a three",
  { black: ["H8","H9","H10","H11", "F10","G11"], play: "H12" }, "win");

// ── 四四 ──────────────────────────────────────────────────
check("two crossing fours = 四四",
  { black: ["E8","F8","G8", "H5","H6","H7"], play: "H8" }, "doubleFour");
check("四三 is legal (four + open three)",
  { black: ["E8","F8","G8", "H6","H7"], play: "H8" }, "none");
check("四四 off -> legal",
  { black: ["E8","F8","G8", "H5","H6","H7"], play: "H8",
    rules: { doubleThree:false, doubleFour:false, overline:true } }, "none");
check("WHITE double four is legal",
  { white: ["E8","F8","G8", "H5","H6","H7"], play: "H8", by: 2 }, "none");

// ── 三三 ──────────────────────────────────────────────────
check("two crossing open threes = 三三",
  { black: ["F8","G8", "H6","H7"], play: "H8" }, "doubleThree");
check("blocked three does not count (OXXX.)",
  { black: ["F8","G8", "H6","H7"], white: ["E8"], play: "H8" }, "none");
check("both blocked -> legal",
  { black: ["F8","G8", "H6","H7"], white: ["E8","H5"], play: "H8" }, "none");
check("三三 off -> legal",
  { black: ["F8","G8", "H6","H7"], play: "H8",
    rules: { doubleThree:false, doubleFour:true, overline:true } }, "none");
check("WHITE double three is legal",
  { white: ["F8","G8", "H6","H7"], play: "H8", by: 2 }, "none");

// split shapes must still register — the bug that bit lines.ts twice
// F8 _ H8 I8 -> after H8 the row reads X.XX, a split open three
check("split open three counts (X.XX)",
  { black: ["F8","I8", "H6","H7"], play: "H8" }, "doubleThree");

// ── single shapes are never forbidden ────────────────────
check("one open three alone is legal", { black: ["G8","F8"], play: "H8" }, "none");
check("one four alone is legal", { black: ["E8","F8","G8"], play: "H8" }, "none");

console.log("\n  shape counters on the 三三 fixture:");
{
  const b = applyMove(build(["F8","G8","H6","H7"]), fromLabel("H8", S), 1);
  console.log(`    open threes = ${countOpenThrees(b, S, fromLabel("H8", S), 1)} (want 2)`);
  console.log(`    fours       = ${countFours(b, S, fromLabel("H8", S), 1)} (want 0)`);
}

// forbiddenPoints must find the same points outcomeOf reports, for the board markers
{
  const fp = forbiddenPoints(build(["F8","G8","H6","H7"]), S, RENJU);
  const got = [...fp].map(([i, k]) => `${toLabel(i, S)}=${k}`).sort().join(",");
  const want = "H8=doubleThree";
  if (got === want) console.log(`  PASS ${"forbiddenPoints marks the 三三 point".padEnd(40)} ${got}`);
  else { fail++; console.log(`  FAIL forbiddenPoints got "${got}" want "${want}"`); }

  const fo = forbiddenPoints(build(["H8","H9","H10","H11","H13"]), S, RENJU);
  const got2 = [...fo].map(([i, k]) => `${toLabel(i, S)}=${k}`).join(",");
  if (got2 === "H12=overline") console.log(`  PASS ${"forbiddenPoints marks the 長連 point".padEnd(40)} ${got2}`);
  else { fail++; console.log(`  FAIL 長連 point got "${got2}"`); }

  if (forbiddenPoints(build(["F8","G8","H6","H7"]), S, FREESTYLE).size === 0) {
    console.log(`  PASS ${"no forbidden points in free-style".padEnd(40)} 0`);
  } else { fail++; console.log("  FAIL free-style should have no forbidden points"); }
}

console.log(`\n  ${fail === 0 ? "禁手 judgement correct" : `${fail} failure(s)`}`);
process.exit(fail ? 1 : 0);
