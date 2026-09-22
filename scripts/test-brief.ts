/**
 * 素盘 state shape. No network. The point of the convention is what it does
 * NOT contain, so the assertions are on the keys.
 */
import { applyMove, createBoard, fromLabel } from "../lib/board";
import { buildBriefState } from "../lib/jev";
import { FREESTYLE, type Rules } from "../lib/renju";

const S = 15;
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const KEYS = ["black_stones", "board", "forbidden_rules", "game", "white_stones", "you_play"];

let b = createBoard(S);
b = applyMove(b, fromLabel("H8", S), 1);

const white = buildBriefState(b, S, 2, FREESTYLE);
ok("free-style keys", Object.keys(white).sort().join() === KEYS.join(), Object.keys(white).join());
ok("white seat", white.you_play.startsWith("white"));
ok("names the game", white.game.startsWith("五子棋"));
ok("no rules", white.forbidden_rules === "none");
ok("lists the stone", white.black_stones.includes("H8") && white.white_stones.length === 0);
ok("diagram shows it", white.board.includes("X"));
ok("win line when unrestricted", white.game.includes("Five or more"));

const black = buildBriefState(b, S, 1);
ok("black seat", black.you_play.startsWith("black"));
ok("omitted rules are none", black.forbidden_rules === "none");

const onlyThree: Rules = { doubleThree: true, doubleFour: false, overline: false };
const three = buildBriefState(b, S, 1, onlyThree);
const threeText = (three.forbidden_rules as string[]).join("\n");
ok("三三 is stated", threeText.includes("三三"));
ok("四四 stays off", !threeText.includes("四四"));
ok("長連 stays off", !threeText.includes("長連"));
ok("still five-or-more", three.game.includes("Five or more"));

const strict: Rules = { doubleThree: true, doubleFour: true, overline: true };
const renju = buildBriefState(b, S, 2, strict);
const renjuText = (renju.forbidden_rules as string[]).join("\n");
ok("all three rules", ["三三", "四四", "長連"].every((s) => renjuText.includes(s)));
ok("binds black only", renjuText.includes("black only"));
ok("exactly five under 長連", renjuText.includes("exactly five"));
ok("no five-or-more headline", !renju.game.includes("Five or more"));
ok("white still holds white", renju.you_play.startsWith("white"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
