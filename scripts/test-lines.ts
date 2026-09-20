// Threat enumeration must see split shapes. The contiguous-run version reported
// XX.XX as two "open two"s, which is how a human beats this thing casually.
import { type Board, createBoard, applyMove, fromLabel } from "../lib/board";
import { enumerateThreats } from "../lib/lines";

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
  black: string[],
  want: { severity: string; critical?: string[] } | null,
  white: string[] = [],
) {
  const ts = enumerateThreats(build(black, white), S, 2).filter((t) => t.player.startsWith("black"));
  const top = ts[0];
  if (want === null) {
    const bad = ts.find((t) => t.severity === "four" || t.severity === "five");
    if (bad) { fail++; console.log(`  FAIL ${name.padEnd(26)} expected no four/five, got ${bad.severity} ${bad.pattern}`); }
    else console.log(`  PASS ${name.padEnd(26)} no four/five, as expected`);
    return;
  }
  if (!top) { fail++; console.log(`  FAIL ${name.padEnd(26)} nothing enumerated`); return; }
  const sevOk = top.severity === want.severity;
  const critOk = !want.critical || want.critical.every((c) => top.critical_points.includes(c));
  if (sevOk && critOk) {
    console.log(`  PASS ${name.padEnd(26)} ${top.severity.padEnd(5)} ${top.pattern}  crit=${top.critical_points.join(",")}`);
  } else {
    fail++;
    console.log(`  FAIL ${name.padEnd(26)} got ${top.severity} ${top.pattern} crit=${top.critical_points.join(",")} want ${want.severity} ${want.critical ?? ""}`);
  }
}

console.log("threat enumeration — split shapes are the whole point\n");

check("contiguous three .XXX.", ["H8", "H9", "H10"], { severity: "three" });
check("contiguous four XXXX",  ["H8", "H9", "H10", "H11"], { severity: "four", critical: ["H12"] });
check("SPLIT four XX.XX",      ["H8", "H9", "H11", "H12"], { severity: "four", critical: ["H10"] });
check("SPLIT four X.XXX",      ["H8", "H10", "H11", "H12"], { severity: "four", critical: ["H9"] });
check("SPLIT four XXX.X",      ["H8", "H9", "H10", "H12"], { severity: "four", critical: ["H11"] });
check("SPLIT three X.XX",      ["H8", "H10", "H11"], { severity: "three" });
check("SPLIT three XX.X",      ["H8", "H9", "H11"], { severity: "three" });
check("diagonal split four",   ["D4", "E5", "G7", "H8"], { severity: "four", critical: ["F6"] });
check("anti-diagonal three",   ["J6", "I7", "G9"], { severity: "three" });

// negatives: a blocked shape is not a threat
check("XXOXX is blocked", ["H8", "H9", "H11", "H12"], null, ["H10"]);
check("XXXXO one side blocked", ["H8", "H9", "H10", "H11"], { severity: "four", critical: ["H7"] }, ["H12"]);
check("XXXX walled both ends", ["H8", "H9", "H10", "H11"], null, ["H7", "H12"]);

console.log(`\n  ${fail === 0 ? "all split shapes visible" : `${fail} failure(s) — humans will still walk through this`}`);
process.exit(fail ? 1 : 0);
