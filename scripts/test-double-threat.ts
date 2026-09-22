/**
 * `double_threat` must mean two FORCING shapes at once: a four, or an open three.
 *
 *   npx tsx scripts/test-double-threat.ts
 *
 * The first version counted any three, so two blocked threes — which force
 * nothing — were labelled 四三 / 双三 and sorted above a real four. In the
 * logged human games 70 of 131 labels were that. No network, no key.
 */
import { type Board, type Player, createBoard, applyMove, fromLabel } from "../lib/board";
import { pointEffects, type DoubleThreatMode } from "../lib/effects";
import { buildState } from "../lib/jev";

const S = 15;
let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}`);
  ok ? pass++ : fail++;
}
function place(stones: Array<[string, Player]>): Board {
  let b = createBoard(S);
  for (const [l, p] of stones) b = applyMove(b, fromLabel(l, S), p);
  return b;
}
const dt = (b: Board, point: string, me: Player = 2) =>
  pointEffects(b, S, me, false, true, false, true).find((e) => e.point === point)?.double_threat;
const wouldMake = (b: Board, point: string, me: Player) => {
  const e = pointEffects(b, S, me, false, false, true, true).find((x) => x.point === point);
  return e?.white_would_make ?? e?.black_would_make;
};

// White to move at H8 in every case. Horizontal F8 G8, vertical H6 H7.

// Both lines capped by a black stone: H8 makes two blocked threes.
const twoBlocked = place([["F8", 2], ["G8", 2], ["E8", 1], ["H6", 2], ["H7", 2], ["H5", 1], ["A1", 1], ["A15", 1]]);
check("two blocked threes are not a double threat", dt(twoBlocked, "H8") === undefined);

// Both lines open: H8 makes 双三.
const twoOpen = place([["F8", 2], ["G8", 2], ["H6", 2], ["H7", 2], ["A1", 1], ["A15", 1]]);
check("two open threes are a double threat", (dt(twoOpen, "H8") ?? []).length === 2);

// Horizontal is a four (E8 F8 G8 + H8), vertical an open three: 四三.
const fourThree = place([["E8", 2], ["F8", 2], ["G8", 2], ["H6", 2], ["H7", 2], ["A1", 1], ["A15", 1], ["O1", 1]]);
check("four plus open three is a double threat", (dt(fourThree, "H8") ?? []).length === 2);

// The same four with the vertical three capped: one forcing shape only.
const fourBlocked = place([["E8", 2], ["F8", 2], ["G8", 2], ["H6", 2], ["H7", 2], ["H5", 1], ["A1", 1], ["A15", 1]]);
check("four plus blocked three is not a double threat", dt(fourBlocked, "H8") === undefined);

// `<colour>_would_make` follows the same rule, seen from the other seat:
// black (Jev) is told what WHITE would make at H8.
check("would_make ignores two blocked threes", wouldMake(twoBlocked, "H8", 1) === undefined);
check("would_make reports two open threes", (wouldMake(twoOpen, "H8", 1) ?? []).length === 2);

// "split": the points "legacy" mislabelled keep their rank under an honest name.
const eff = (b: Board, point: string, mode: DoubleThreatMode) =>
  pointEffects(b, S, 2, false, mode, false, true).find((e) => e.point === point);
check("legacy labels two blocked threes as a double threat", (eff(twoBlocked, "H8", "legacy")?.double_threat ?? []).length === 2);
check("split moves them to shapes_on_two_lines",
  eff(twoBlocked, "H8", "split")?.double_threat === undefined
  && (eff(twoBlocked, "H8", "split")?.shapes_on_two_lines ?? []).length === 2);
check("split keeps a real double threat as double_threat",
  (eff(fourThree, "H8", "split")?.double_threat ?? []).length === 2
  && eff(fourThree, "H8", "split")?.shapes_on_two_lines === undefined);
check("four plus blocked three is shapes_on_two_lines under split", (eff(fourBlocked, "H8", "split")?.shapes_on_two_lines ?? []).length === 2);
// A real block of an open three outranks a point that only makes shapes on two lines.
// Black open three E10 F10 G10; white can make two blocked threes at H8 (as above).
const blockVsShapes = place([["F8", 2], ["G8", 2], ["E8", 1], ["H6", 2], ["H7", 2], ["H5", 1], ["E10", 1], ["F10", 1], ["G10", 1], ["A15", 1]]);
const ordered = pointEffects(blockVsShapes, S, 2, false, "split", false, true, true);
// Both ends of a plain open three leave a four, and neither is demoted for it.
const iBlock = ordered.findIndex((e) => e.blocks_black?.startsWith("open three"));
const iShapes = ordered.findIndex((e) => e.point === "H8");
check("blocking a plain open three ranks above shapes_on_two_lines", iBlock >= 0 && iShapes >= 0 && iBlock < iShapes);

// `leaves`: the two ends of an open three are not equal. White blocks black's split three E10 . G10 H10.
const split3 = place([["E10", 1], ["G10", 1], ["H10", 1], ["A1", 2], ["A15", 1]]);
const pe3 = pointEffects(split3, S, 2, false, false, false, false, true);
const gap = pe3.find((e) => e.point === "F10")?.leaves ?? "";
const end = pe3.find((e) => e.point === "D10")?.leaves ?? "";
check("blocking the gap of a split three leaves no four", !gap.includes("can still make a four"));
check("blocking an outer end of a split three leaves a four at the gap", end.includes("can still make a four") && end.includes("F10"));

// `blocks_*` says whether the three it answers is open. Black E8 F8 G8, open.
const openBlack = place([["E8", 1], ["F8", 1], ["G8", 1], ["A1", 2]]);
const blockOpen = pointEffects(openBlack, S, 2).find((e) => e.point === "H8")?.blocks_black ?? "";
check("blocking an open three says open three", blockOpen.startsWith("open three"));
const cappedBlack = place([["E8", 1], ["F8", 1], ["G8", 1], ["D8", 2], ["A1", 2]]);
const blockCapped = pointEffects(cappedBlack, S, 2).find((e) => e.point === "H8")?.blocks_black ?? "";
check("blocking a capped three says blocked three", blockCapped.startsWith("blocked three"));

// `stones_on_board` counts the board, not the history: handicap stones have no history entry.
const handicap = place([["H8", 1], ["H9", 1]]);
const st = buildState(handicap, S, 2, [], true) as { stones_on_board: number };
check("stones_on_board counts stones with no history entry", st.stones_on_board === 2);

// Any block of an open three outranks killing a blocked three. White to move:
// black open three E10 F10 G10, and black blocked three C3 D3 E3 capped at B3.
const both3 = place([["E10", 1], ["F10", 1], ["G10", 1], ["C3", 1], ["D3", 1], ["E3", 1], ["B3", 2], ["A15", 2]]);
const pe4 = pointEffects(both3, S, 2, false, "split", false, true, true);
const firstOpenBlock = pe4.findIndex((e) => e.blocks_black?.startsWith("open three"));
const firstBlockedBlock = pe4.findIndex((e) => e.blocks_black?.startsWith("blocked three"));
check("blocking an open three ranks above killing a blocked three", firstOpenBlock >= 0 && firstBlockedBlock >= 0 && firstOpenBlock < firstBlockedBlock);

// `dropBlockedThreeBlocks`: a blocked three gets no `blocks_*`; an open three still does.
const pe5 = pointEffects(both3, S, 2, false, "split", false, true, true, true);
check("dropBlockedThreeBlocks removes blocks of a blocked three", !pe5.some((e) => e.blocks_black?.startsWith("blocked three")));
check("dropBlockedThreeBlocks keeps blocks of an open three", pe5.some((e) => e.blocks_black?.startsWith("open three")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
