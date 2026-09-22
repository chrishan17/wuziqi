// The "naked Jev" baseline: Jev picks from EVERY empty cell on the board.
//
// Deliberately NO help from code:
//   - no candidate filtering, no proximity pruning, no ordering
//   - no tactical labels (open-three / four / block) in the state
//   - no threat detection handed to the model
//   - every option description is null
// Win detection exists in lib/board.ts as the referee only: it runs AFTER a move
// is played, never to trim the option set before Jev sees it.

import { callJev, activeTransport, type Question } from "./transport";
import { forbiddenPoints, type Rules } from "./renju";
import { analyseForbidden } from "./exploit";
import { pointEffects, type DoubleThreatMode } from "./effects";
import { enumerateLines, stoneRelations, diagonalOpening as diagonalOpeningFacts, diagonalBranches, blockedRuns } from "./lines";
import {
  type Board,
  type Player,
  emptyCells,
  renderAscii,
  stonesOf,
  toLabel,
  fromLabel,
} from "./board";

export const JEV_MODEL = process.env.JEV_MODEL ?? "typesafe-ai/jev";

/** One candidate's second-pass verdict. Raw answers; policy lives in code. */
export type VerifiedCandidate = {
  label: string;
  /** Round-one probability from `best_move`. */
  p1: number;
  /** P(this move makes a threat the opponent cannot fully answer). */
  unanswerable: number;
  /** P(the opponent has a forcing win after this move). */
  refuted: number;
  /** `p1 + A_u*unanswerable - A_r*refuted`. Recomputable from the two raw answers. */
  score: number;
};

export type MoveTrace = {
  move: string;
  moveIdx: number;
  probabilities: Record<string, number>;
  topMoves: Array<{ label: string; p: number }>;
  predictedReply: string | null;
  predictedReplyProbabilities: Record<string, number> | null;
  position: { score: number; probabilities?: Record<string, number> } | null;
  opponentThreat: number | null;
  optionCount: number;
  /** Present only when the second pass ran. Ordered by `score`, best first. */
  verified: VerifiedCandidate[] | null;
  /** True when the second pass moved Jev off its round-one choice. */
  verifySwitched: boolean;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  warnings: unknown[];
  transport: "gateway" | "native";
};

function describe(player: Player) {
  return player === 1
    ? { self: "black (X)", foe: "white (O)", selfP: 1 as Player, foeP: 2 as Player }
    : { self: "white (O)", foe: "black (X)", selfP: 2 as Player, foeP: 1 as Player };
}

export type HistoryEntry = string | { move: string; player: Player };

function normaliseHistory(history: HistoryEntry[]): string[] {
  // The state must not imply a move order that never happened. When entries are
  // untagged we fall back to strict alternation from black, which is the real
  // sequence for a game played through the UI.
  return history.map((h, i) =>
    typeof h === "string"
      ? `${i % 2 === 0 ? "black (X)" : "white (O)"} played ${h}`
      : `${h.player === 1 ? "black (X)" : "white (O)"} played ${h.move}`,
  );
}

/**
 * Priority order. Useless on its own (0/15 in scripts/experiment.ts) but it
 * sharpens the distribution once `lines` makes the position visible.
 */
export const PRIORITY = [
  "1. If you can place a stone that makes five in a row, play it and win immediately.",
  "2. Otherwise, if the opponent would make five on their next move, take that point to block it.",
  "3. Otherwise, if the opponent has four in a row with an open end, block that end.",
  "4. Otherwise, if the opponent has three in a row with both ends open, block one end now. Left alone it becomes an open four, which can no longer be stopped.",
  "5. Otherwise, extend your own longest line that still has open ends.",
  "Defending against a line that is about to become unstoppable takes priority over building your own shorter line.",
];

/**
 * The same ladder for the side holding the INITIATIVE (black, who opens).
 *
 * `PRIORITY` was written when Jev only ever played white, the reacting seat:
 * items 2-4 are all blocks, the player's own offence is last, and the closing
 * line says defence beats offence outright. Handed to black that reads as
 * "answer whatever they do", which is the wrong game for the side that leads.
 *
 * This variant keeps every genuinely forced item (win now, block five, block an
 * open four) and interleaves the player's own threats above the merely urgent
 * ones, because a four or an open three forces the opponent to answer and hands
 * the initiative back. Untested until measured — see scripts/colour-check.ts.
 */
export const PRIORITY_INITIATIVE = [
  "1. If you can place a stone that makes five in a row, play it and win immediately.",
  "2. Otherwise, if the opponent would make five on their next move, take that point to block it.",
  "3. Otherwise, if you can make a four, play it. A four forces the opponent to spend their move answering it, so you keep the initiative.",
  "4. Otherwise, if the opponent has four in a row with an open end, block that end.",
  "5. Otherwise, if you can make a three with both ends open, play it. That is stronger than blocking their open three, because they must answer yours first.",
  "6. Otherwise, if the opponent has three in a row with both ends open, block one end. Left alone it becomes an open four, which can no longer be stopped.",
  "7. Otherwise, extend your own longest line that still has open ends, preferring a point that also limits theirs.",
  "You are the attacker. When your own threat is at least as severe as the opponent's, make yours instead of answering theirs — forcing them to respond is worth more than a safe block.",
];

/**
 * `PRIORITY_INITIATIVE` for black's first four stones only.
 *
 * Item 7 tells Jev to extend its longest line. In the opening that is the whole
 * policy: `lines_on_board` and `point_effects` are empty until two stones share
 * a window, so the wording is what gets played, and the first four stones come
 * out on one straight line. `PRIORITY_SHAPE` replaced that rule for the entire
 * game and the late game got worse, so this text is used only while black has
 * fewer than four stones down.
 *
 * Measured against L3, 5 paired seeds (12000–12004), 10 games, `scripts/test-opening-l3.ts`:
 * both arms 4-1, zero discordant games. The text changed the opening in 2 of 5,
 * and the fourth stone left the line in 1 of 5. Items 1–6 still outrank it, so
 * once two stones can be extended into an open three, item 5 plays that extension
 * and the line is rebuilt. Not wired into `app/api/move/route.ts`.
 */
export const PRIORITY_OPENING = [
  ...PRIORITY_INITIATIVE.slice(0, 6),
  "7. Otherwise, if you have not yet played, play the centre point. Black moves first, and the first stone belongs there.",
  "8. Otherwise, if you have exactly one stone, do not play on the straight line that passes through that stone and the nearest opponent stone. Play next to your own stone, off that line, so the second stone starts a second direction.",
  "9. Otherwise, if all of your stones lie on one straight line, play off that line, next to a stone you already have. One block stops a single line. Two directions cannot be stopped by the same stone, and that is how moving first is converted. Making the only line longer can wait until a second direction exists.",
  "You moved first. An opponent stone that is not yet a four or an open three does not need an answer during the opening. Spend the move on your own shape.",
];

/** Ladder for one move. `opening` is the measured-flat 执黑 text. `diagonal` ranks a diagonal step off a straight line above extending that line, for black's first four stones. */
export function priorityFor(jev: Player, ownStones: number, opening = false, diagonal = false): string[] {
  if (jev !== 1) return PRIORITY;
  if (diagonal && ownStones < 4) return PRIORITY_DIAGONAL;
  if (opening && ownStones < 4) return PRIORITY_OPENING;
  return PRIORITY_INITIATIVE;
}

/**
 * Black's first four stones. Items 1–4 of `PRIORITY_INITIATIVE` stay first
 * (five, block five, make a four, block an open four). The next item is a
 * diagonal step off a straight line, ahead of making an open three, because
 * an open three along the only line is what rebuilt the straight line when
 * the same advice sat below it.
 *
 * A diagonal pair branches into more live twos than a straight pair, and one
 * opposing stone often cannot block both. The points themselves are in
 * `opening` on the state. After four stones the ladder returns to
 * `PRIORITY_INITIATIVE`.
 *
 * Measured against L3, seeds 13000–13004, 10 games (`scripts/test-diagonal.ts`):
 * 详注 5-0, 斜向 1-4. Every opening moved, usually onto one diagonal
 * (H8 G7 …) instead of one horizontal, and that lost the four games the
 * straight opening won. Not wired into `app/api/move/route.ts`.
 */
export const PRIORITY_DIAGONAL = [
  ...PRIORITY_INITIATIVE.slice(0, 4),
  "5. Otherwise, if `opening.diagonal_off_that_line` lists any points, play one of them rather than a point in `opening.straight_extensions`. Do this even when a straight extension would make an open three. A diagonal pair branches into more live twos than a straight pair, and one opposing stone often cannot block both. A single straight line is stopped by one block.",
  "6. Otherwise, if you can make a three with both ends open, play it. That is stronger than blocking their open three, because they must answer yours first.",
  "7. Otherwise, if the opponent has three in a row with both ends open, block one end. Left alone it becomes an open four, which can no longer be stopped.",
  "8. Otherwise, if you have not yet played, play the centre point. Black moves first, and the first stone belongs there.",
  "9. Otherwise, extend your own longest line that still has open ends, preferring a point that also limits theirs.",
  "You are the attacker. When your own threat is at least as severe as the opponent's, make yours instead of answering theirs — forcing them to respond is worth more than a safe block.",
];

/**
 * Whole-game diagonal lean for the side holding the initiative. This is what
 * 详注 sends for black.
 *
 * An open three outranks a diagonal step. The two are not alternatives: when
 * several points make an open three, the diagonal one is the open three to
 * play. `diagonal_branches` is only reached when no open three can be made.
 * Putting the branch above the open three was measured and lost
 * (seeds 14000–14004, `scripts/test-lean.ts`); that order is not this text.
 * Fives and fours stay above both. Blocking the opponent's open three stays
 * above making your own: if they already have one, making yours does not
 * force an answer, and they turn theirs into an open four. The direction is
 * on the `point_effects` phrase.
 */
export const PRIORITY_LEAN = [
  ...PRIORITY_INITIATIVE.slice(0, 4),
  "5. Otherwise, if the opponent has three in a row with both ends open, block one end. Left alone it becomes an open four, which can no longer be stopped. Making an open three of your own does not force them to answer first.",
  "6. Otherwise, if you can make a three with both ends open, play it. When more than one point makes an open three, play the one whose direction in `point_effects` is diagonal rather than horizontal or vertical.",
  "7. Otherwise, if `diagonal_branches` lists points, play one of them rather than extending a horizontal or vertical line. Each of those points starts a two on a diagonal. With one stone of yours there is no open three yet, so this is where the second stone goes: a diagonal neighbour, not an orthogonal one. If your diagonal is already blocked on both ends, these points are the other diagonal — play one of them, not a point that only sits between opponent stones. If an open three of yours can be made, item 6 already played it.",
  "8. Otherwise, extend a diagonal line of yours that still has open ends. If you have no diagonal line, extend your longest line that still has open ends, preferring a point that also limits theirs.",
  "You are the attacker. A four of yours is answered before their open three, because they must spend the move on your four. Their open three is answered before an open three of yours. When you are building and the threats are equal, the diagonal one comes first.",
];

/**
 * `PRIORITY_LEAN` with its unconditional "make a four" rule removed, and the
 * two facts `point_effects` already carries — `double_threat` (yours) and
 * `white_would_make` (theirs) — given a place on the ladder. Pair with
 * `keyPoints` and `doubleThreat: "split"`.
 *
 * Why: replaying the 20-game run (seeds 51000+), Jev saw `white_would_make`
 * on the point that later beat it — once as entry #0 — and played a plain four
 * instead, because item 3 of `PRIORITY_LEAN` said "if you can make a four, play
 * it". In 51017 it made seven plain fours in a row while the opponent's key
 * point stayed open. A plain four is answered by one block; the instruction
 * was overriding the fact.
 */
export const PRIORITY_KEY = [
  ...PRIORITY_INITIATIVE.slice(0, 2),
  "3. Otherwise, if a point in `point_effects` carries `double_threat` for you and one of its threats is a four, play it. A four and a second threat made by one stone cannot both be answered with one block. If its threats are two open threes, play it only when the opponent has no open three and no four on the board — otherwise they turn theirs into an open four first.",
  "4. Otherwise, if the opponent has four in a row with an open end, block that end.",
  "5. Otherwise, if a point in `point_effects` carries `white_would_make`, take that point now. It lists the two threats white would make there with a single stone; once white plays it, one block cannot answer both.",
  "6. Otherwise, if the opponent has three in a row with both ends open, block one end. Left alone it becomes an open four, which can no longer be stopped. Making an open three of your own does not force them to answer first.",
  PRIORITY_LEAN[5].replace(/^6\./, "7."),
  PRIORITY_LEAN[6].replace(/^7\./, "8.").replace("item 6", "item 7"),
  PRIORITY_LEAN[7].replace(/^8\./, "9."),
  "A four that makes no second threat is answered by a single block and uses up that line. Do not play one just to keep the initiative: make a four only when it is part of a `double_threat`, when you can follow it with another four until five, or when it blocks the opponent.",
];

/**
 * `PRIORITY_KEY` with item 6 pointing at `leaves`: the blocking points of an
 * open three are not equal. Pair with `blockLeaves`.
 */
export const PRIORITY_KEY_LEAVES = PRIORITY_KEY.map((line) => line.startsWith("6.") ? "6. Otherwise, if the opponent has three in a row with both ends open, block it. Left alone it becomes an open four, which can no longer be stopped. Making an open three of your own does not force them to answer first. The blocking points of that open three are not equal: each one's `leaves` says what that line can still make for them afterwards. Among the points that block the open three, prefer one whose `leaves` says the line can no longer make five, or at least leaves no four; a block that leaves them a four on the line is where they come back. Blocking a blocked three instead does not answer the open three." : line);

/**
 * Same lean for white, who answers first. 详注 sends this. Blocking a five or
 * an open four stays first, then an open three — yours or theirs — and only
 * then a diagonal step that is not itself an open three.
 */
export const PRIORITY_LEAN_WHITE = [
  ...PRIORITY.slice(0, 4),
  "5. Otherwise, if you can make a three with both ends open, play it. When more than one point does, play the one whose direction in `point_effects` is diagonal rather than horizontal or vertical.",
  "6. Otherwise, if `diagonal_branches` lists points, play one of them rather than an orthogonal neighbour. Your first reply beside an opponent stone belongs on a diagonal. If an open three exists, item 5 already played it.",
  "7. Otherwise, extend a diagonal line of yours that still has open ends. If you have no diagonal line, extend your longest line that still has open ends.",
  "Defending against a line that is about to become unstoppable takes priority over building your own shorter line. When you are building and the threats are equal, the diagonal one comes first.",
];

/**
 * `PRIORITY_INITIATIVE` with its last building rule rewritten.
 *
 * Measured: with the old wording Jev's first four stones as black sit on ONE
 * straight line in every game (`1-line` 1.00 vs white's 0.70). Item 7 said
 * "extend your own longest line", which is literally an instruction to build a
 * straight line — and a straight line is answered by blocking one end. Adding
 * the missing relationship to `point_effects` did not help, because in the
 * opening that field is empty; the opening is governed by the wording alone.
 */
export const PRIORITY_SHAPE = [
  ...PRIORITY_INITIATIVE.slice(0, 6),
  "7. Otherwise, play a point that works on two of your lines at once — a point that extends one of your stones in one direction while also lining up with another of your stones in a different direction. Prefer that to making your single longest line longer.",
  "A single straight line is answered by blocking one end of it. Two of your lines crossing cannot both be blocked with one stone, and that is how the game is actually won. Build width, not length.",
  "You are the attacker. When your own threat is at least as severe as the opponent's, make yours instead of answering theirs — forcing them to respond is worth more than a safe block.",
];

/**
 * The brief convention. Four facts and nothing else: this is gomoku, which
 * colour Jev holds, the board as it stands, and whether 禁手 is on.
 *
 * No lines, no point effects, no priority ladder, no history, no
 * `forbidden_analysis`. The page switches to this with 素盘. Unmeasured —
 * do not fold it back into `buildState`.
 */
export function buildBriefState(
  board: Board,
  size: number,
  jev: Player,
  rules?: Rules,
) {
  const { self } = describe(jev);
  const active = !!(rules && (rules.overline || rules.doubleThree || rules.doubleFour));
  const restrictions: string[] = [];
  if (active && rules) {
    restrictions.push(
      "Forbidden moves bind black only. White is unrestricted and still wins with six or more in a row.",
    );
    if (rules.overline) {
      restrictions.push(
        "長連 is on: black wins only with exactly five in a row. Six or more in a row loses for black.",
      );
    }
    if (rules.doubleFour) {
      restrictions.push("四四 is on: a black move that forms two fours at once loses for black.");
    }
    if (rules.doubleThree) {
      restrictions.push("三三 is on: a black move that forms two open threes at once loses for black.");
    }
    restrictions.push(
      "A black move that makes exactly five wins, even if it also breaks a restriction.",
    );
  }
  return {
    game: active && rules?.overline
      ? "五子棋 (Gomoku)."
      : "五子棋 (Gomoku). Five or more of your own stones in an unbroken line wins.",
    you_play: self,
    board: renderAscii(board, size),
    black_stones: stonesOf(board, size, 1),
    white_stones: stonesOf(board, size, 2),
    forbidden_rules: active ? restrictions : "none",
  };
}

export function buildState(
  board: Board,
  size: number,
  jev: Player,
  history: HistoryEntry[],
  /** Include enumerated lines. This is the single change that took forced-move accuracy from 0/15 to 15/15. */
  withLines = false,
  /** Active 禁手 rules, so Jev does not misjudge black's overline as a threat. */
  rules?: Rules,
  /** Omit `point_effects`. Used by scripts/test-offense.ts as the control. */
  noEffects = false,
  /** Add `builds_on` (every direction a point builds in) to `point_effects`. */
  multiAxis = false,
  /** Add `double_threat` to `point_effects` — 四三 / 双三 in one field. See `DoubleThreatMode`. */
  doubleThreat: DoubleThreatMode = false,
  /** Add `stone_relations`, the opening-only cross-colour geometry. */
  openingRelations = false,
  /** Add `<colour>_would_make`: the points the OPPONENT turns into a 四三 / 双三. */
  keyPoints = false,
  /** List diagonal steps off a straight line. Only meaningful with `PRIORITY_DIAGONAL`. */
  diagonalOpening = false,
  /**
   * Whole-game diagonal lean. Names the direction on each `point_effects`
   * phrase and, while the stones are still on one straight line, lists the
   * outward diagonal steps in `diagonal_branches`. Pair with `PRIORITY_LEAN`
   * or `PRIORITY_LEAN_WHITE`.
   */
  leanDiagonal = false,
  /** `leaves` on blocks of a three and the ranking that goes with it. Pair with `PRIORITY_KEY`. */
  blockLeaves = false,
  /** Omit `blocks_*` entries for blocked threes. See `pointEffects`. */
  dropBlockedThreeBlocks = false,
) {
  const { self, foe } = describe(jev);
  const lastCols = "A".charCodeAt(0);
  const restricted = !!(rules && (rules.overline || rules.doubleThree || rules.doubleFour));
  return {
    // Must agree with `win_condition`. This used to say "no forbidden moves"
    // unconditionally, so with 禁手 on the state contradicted itself.
    game: restricted
      ? "Gomoku (five-in-a-row) with forbidden moves for black (Renju restrictions), listed in `win_condition`"
      : "Gomoku (five-in-a-row), free-style rules, no forbidden moves",
    board_size: `${size}x${size}`,
    coordinates: `Columns are letters ${String.fromCharCode(lastCols)}-${String.fromCharCode(
      lastCols + size - 1,
    )} from left to right. Rows are numbers 1-${size} from top to bottom. A point is written as column then row, for example ${toLabel(
      Math.floor((size * size) / 2),
      size,
    )} is the centre of the board.`,
    win_condition: restricted && rules
      ? [
          "White wins by getting five OR MORE white stones in an unbroken line, horizontally, vertically or diagonally. White has no restrictions.",
          "Black wins only with EXACTLY five in a row. Black is also bound by the restrictions below, and loses immediately on breaking one.",
          ...(rules.overline ? ["Black restriction 長連: six or more black stones in an unbroken line loses for black."] : []),
          ...(rules.doubleFour ? ["Black restriction 四四: a black move forming two separate fours at once loses for black."] : []),
          ...(rules.doubleThree ? ["Black restriction 三三: a black move forming two separate open threes at once loses for black."] : []),
          "A black move that makes exactly five wins, even if it would otherwise break a restriction.",
        ]
      : "A player wins immediately by getting five or more of their own stones in an unbroken line, horizontally, vertically, or diagonally.",
    you_play: self,
    opponent_plays: foe,
    board_diagram: renderAscii(board, size),
    black_stones: stonesOf(board, size, 1),
    white_stones: stonesOf(board, size, 2),
    move_history: normaliseHistory(history),
    // Counted from the board: handicap stones are on it but not in `history`.
    stones_on_board: board.filter((v) => v !== 0).length,
    ...(withLines
      ? {
          lines_on_board: [...enumerateLines(board, size, 2), ...blockedRuns(board, size)],
          lines_note:
            "Every run of two or more stones already on the board, longest first, with the empty points at each end. A line with no critical points has both ends blocked and cannot grow.",
        }
      : {}),
    // Only present when 禁手 is active. States what black is barred from doing;
    // it names no move and draws no conclusion.
    // What each nearby point would create, for white and against black. Points
    // carrying both fields are the ones that attack while defending.
    ...(withLines && !noEffects
      ? {
          point_effects: pointEffects(board, size, jev, multiAxis, doubleThreat, keyPoints, leanDiagonal, blockLeaves, dropBlockedThreeBlocks),
          point_effects_note: multiAxis
            ? "For each nearby empty point: what it builds for you, which opponent threat it answers, and `builds_on` — every direction it builds in. A point may do all three. A point listed with more than one direction lies on two of your lines at once."
            : "For each nearby empty point: what it builds for you, and which opponent threat it answers. A point may do both."
              + (doubleThreat === "legacy" ? " `double_threat` lists the two or more separate threats a point makes at once." : "")
              + (doubleThreat && doubleThreat !== "legacy" ? " `double_threat` lists the two or more forcing threats (fours or open threes) a point makes at once." : "")
              + (doubleThreat === "split" ? " `shapes_on_two_lines` lists shapes of three or more that a point makes on two or more lines at once when fewer than two of them are a four or an open three." : "")
              + (keyPoints ? " A point carrying `white_would_make` or `black_would_make` is one the OPPONENT would turn into two separate threats at once; it is still empty now." : "")
              + (blockLeaves ? " `leaves`, beside a `blocks_*` entry for an open three, says what that line can still make for the opponent once you take the point." : "")
              + (leanDiagonal ? " The direction of the shape you build is in parentheses. A diagonal shape is listed ahead of a horizontal or vertical shape of the same severity." : ""),
        }
      : {}),
    ...(withLines && openingRelations ? (() => {
      const rel = stoneRelations(board, size);
      return rel
        ? {
            stone_relations: rel,
            stone_relations_note:
              "Stones of opposite colour that share a line. `lines_on_board` only reports runs of one colour, so in the opening these are the only relationships on the board.",
          }
        : {};
    })() : {}),
    ...(withLines && rules ? (() => {
      const fa = analyseForbidden(board, size, rules);
      return fa ? { forbidden_analysis: fa } : {};
    })() : {}),
    ...(diagonalOpening ? (() => {
      const opening = diagonalOpeningFacts(board, size, jev);
      return opening ? { opening } : {};
    })() : {}),
    ...(leanDiagonal ? (() => {
      const branches = diagonalBranches(board, size, jev);
      return branches
        ? { diagonal_branches: branches.points, diagonal_branches_note: branches.note }
        : {};
    })() : {}),
  };
}

/**
 * Second-pass policy. All three are code-side constants on purpose: the raw
 * answers live in `MoveTrace.verified`, so retuning any of these never costs
 * another inference call.
 */
/** How many of round one's candidates are re-examined. */
export const VERIFY_TOP_K = 3;
/**
 * Weights on the two verification terms, relative to round-one probability.
 *
 * They are NOT equal, and the split is measured rather than guessed. Over 216
 * candidate judgments (`scripts/test-verify.ts`), `unanswerable` separates the
 * true cases from the false ones by +0.240 and `refuted` by +0.170, so the
 * weaker question gets proportionally less authority to overturn round one.
 * Fitted on the seeds that harness uses (5000+); the evaluation runs on
 * `colour-check`'s seeds (9000+), which the fit never saw.
 */
export const VERIFY_ALPHA_UNANSWERABLE = 0.5;
export const VERIFY_ALPHA_REFUTED = 0.35;
/**
 * Skip the second pass when round one is already this sure. A 0.95 choice is
 * almost always a forced move — five in a row, or the only block — and paying
 * three more requests to confirm it buys nothing.
 */
export const VERIFY_GATE = 0.9;

/**
 * Re-examine the top candidates, one request per candidate.
 *
 * Why a second round trip rather than more questions in the first: the questions
 * that matter here — "is this threat answerable?", "does this hang a forcing
 * win?" — are about the board AFTER the move, and a `systemOne` call carries one
 * state. The same mistake was already made once with `predicted_reply`, which
 * predicted the opponent against a board without Jev's own stone on it.
 *
 * The requests run in parallel and inference is effectively free at this scale
 * (input $0.042/1M, output free), so the cost is one round trip of latency.
 *
 * Note the orientation: `point_effects` in each candidate's state is computed
 * for JEV, so `for_black`/`blocks_white` describe Jev's side even in the
 * question about the opponent's win. The fields are named for the colours
 * precisely so that cannot be misread.
 */
async function verifyCandidates(opts: {
  board: Board;
  size: number;
  jev: Player;
  history: HistoryEntry[];
  candidates: Array<{ label: string; idx: number; p: number }>;
  informed: boolean;
  rules?: Rules;
  noEffects: boolean;
  multiAxis: boolean;
  doubleThreat: DoubleThreatMode;
  openingRelations: boolean;
  keyPoints: boolean;
  brief: boolean;
  signal?: AbortSignal;
}): Promise<VerifiedCandidate[]> {
  const { board, size, jev, history, candidates, informed, rules, noEffects, multiAxis, doubleThreat, openingRelations, keyPoints, brief, signal } = opts;
  const { self, foe } = describe(jev);

  return Promise.all(
    candidates.map(async (c) => {
      const after = board.slice() as Board;
      after[c.idx] = jev;
      const result = await callJev({
        state: brief
          ? buildBriefState(after, size, jev, rules)
          : buildState(after, size, jev, [...history, { move: c.label, player: jev }], informed, rules, noEffects, multiAxis, doubleThreat, openingRelations),
        questions: {
          unanswerable: {
            type: "boolean" as const,
            instructions: `${self} has just played ${c.label}. Does ${self} now have a threat that ${foe} cannot fully answer with their single next move — two separate threats at once, or a four with two different points that complete five?`,
            criteria: {
              true: `${foe} cannot defuse every threat with one stone, so ${self} wins shortly`,
              false: `one ${foe} stone answers everything ${self} has`,
            },
          },
          refuted: {
            type: "boolean" as const,
            instructions: `${self} has just played ${c.label}. Does ${foe} now have a forcing sequence that wins no matter how ${self} replies?`,
            criteria: {
              true: `${foe} has a forced win from this position`,
              false: `${self} can still answer everything ${foe} has`,
            },
          },
        } as unknown as Record<string, Question>,
        signal,
      });
      const a = result.answers as Record<string, any>;
      const unanswerable = a.unanswerable?.probability ?? 0;
      const refuted = a.refuted?.probability ?? 0;
      return {
        label: c.label,
        p1: c.p,
        unanswerable,
        refuted,
        score:
          c.p
          + VERIFY_ALPHA_UNANSWERABLE * unanswerable
          - VERIFY_ALPHA_REFUTED * refuted,
      };
    }),
  );
}

/** Ask Jev for a move, with every empty point on the board as an option. */
export async function nakedJevMove(opts: {
  board: Board;
  size: number;
  jev: Player;
  history: HistoryEntry[];
  /**
   * Predict the opponent's reply in a second request. Off by default: it costs a
   * round trip and the task here is winning, not commentary.
   */
  includePrediction?: boolean;
  /**
   * Send `best_move` and nothing else. The observation questions cannot see each
   * other's answers, but they share one forward pass, so their wording could in
   * principle prime attention. Use this to check that it does not.
   */
  bare?: boolean;
  /**
   * The "informed" calling convention: enumerated lines in the state and a
   * priority order in the instructions. The option set is unchanged — still
   * every empty point — so this is added context, not candidate filtering.
   * See RESULTS.md: 0/15 forced moves without it, 15/15 with it.
   */
  informed?: boolean;
  /**
   * 素盘. State is only the game, the colour, the board, and whether 禁手 is
   * on. Ignores `informed` and the priority ladder. See `buildBriefState`.
   */
  brief?: boolean;
  /** Active 禁手 rules, passed through to the state. */
  rules?: Rules;
  /** Drop `point_effects` only, keeping everything else. For measurement. */
  noEffects?: boolean;
  /** Override the priority ladder sent with `informed`. Defaults to `PRIORITY`. */
  priority?: string[];
  /** Add `builds_on` to `point_effects`. Measured in scripts/colour-check.ts. */
  multiAxis?: boolean;
  /** Add `double_threat` to `point_effects` — 四三 / 双三 stated as one fact. */
  doubleThreat?: DoubleThreatMode;
  /** `leaves` on blocks of a three. See `buildState`. */
  blockLeaves?: boolean;
  /** Omit `blocks_*` for blocked threes. See `pointEffects`. */
  dropBlockedThreeBlocks?: boolean;
  /** Add `stone_relations`, the opening-only cross-colour geometry. */
  openingRelations?: boolean;
  /** Add `<colour>_would_make`: the points the OPPONENT turns into a 四三 / 双三. */
  keyPoints?: boolean;
  /**
   * Run the second pass: re-examine round one's top candidates against the board
   * as it would stand after each of them. See `verifyCandidates`.
   */
  verify?: boolean;
  /**
   * Black's first four stones: state lists diagonal steps off a straight line,
   * and the caller passes `PRIORITY_DIAGONAL` so that step outranks extending
   * the line into an open three. See `diagonalOpening`.
   */
  diagonalOpening?: boolean;
  /**
   * Whole game: direction on each built shape, and `diagonal_branches` while
   * the stones are still on one straight line. The caller passes `PRIORITY_LEAN`
   * (black) or `PRIORITY_LEAN_WHITE`. Not the opening-only `diagonalOpening`.
   */
  leanDiagonal?: boolean;
  signal?: AbortSignal;
}): Promise<MoveTrace> {
  const { board, size, jev, history, includePrediction = false, bare = false, informed = false, rules, noEffects = false, priority = PRIORITY, multiAxis = false, doubleThreat = false, openingRelations = false, keyPoints = false, verify = false, brief = false, diagonalOpening: diagonal = false, leanDiagonal = false, blockLeaves = false, dropBlockedThreeBlocks = false, signal } = opts;
  const { self, foe } = describe(jev);

  const empties = emptyCells(board);
  if (empties.length === 0) throw new Error("No legal moves: the board is full.");

  // Every empty point, unfiltered and unranked. Null description = no hint.
  //
  // The ONE exception, and it is Layer 0 rather than candidate filtering: when
  // Jev plays BLACK under 禁手, a forbidden point is an instant loss, so it is
  // not a legal move at all and never reaches the option set. This is not the
  // "remove forbidden points from Jev's options" idea AGENTS.md rejects — that
  // was about Jev as WHITE, where those squares are legal and frequently
  // white's own winning square. 禁手 binds black only; the asymmetry is real.
  const barred = jev === 1 && rules ? forbiddenPoints(board, size, rules) : null;
  const allPoints: Record<string, null> = {};
  for (const idx of empties) {
    if (barred?.has(idx)) continue;
    allPoints[toLabel(idx, size)] = null;
  }
  if (Object.keys(allPoints).length === 0) {
    throw new Error("No legal moves: every empty point is forbidden for black.");
  }

  const state = brief
    ? buildBriefState(board, size, jev, rules)
    : buildState(board, size, jev, history, informed, rules, noEffects, multiAxis, doubleThreat, openingRelations, keyPoints, diagonal, leanDiagonal, blockLeaves, dropBlockedThreeBlocks);

  const questions = {
    // The only question that decides play. Everything else is observation.
    best_move: {
      type: "choice" as const,
      instructions: brief
        ? `You are playing ${self} in this game of 五子棋. Choose the empty point where you place your next stone.`
        : {
            task: `You are playing ${self} in this game of gomoku. Choose the point where you will place your next stone.`,
            goal: `Play the strongest move: make your own five-in-a-row while stopping ${foe} from making theirs.`,
            options: "Every option is an empty point on the board, written as column letter then row number.",
            ...(informed ? { priority_order: priority } : {}),
          },
      criteria: allPoints,
    },
    ...(bare ? {} : {
    position: {
      type: "score" as const,
      instructions: `Evaluate the position shown. Who is closer to winning, ${foe} or ${self}?`,
      criteria: [
        `${foe} is winning decisively and ${self} cannot stop it`,
        `${foe} is ahead`,
        "The position is balanced",
        `${self} is ahead`,
        `${self} is winning decisively and ${foe} cannot stop it`,
      ],
    },
    opponent_threat: {
      type: "boolean" as const,
      instructions: `Does ${foe} have a line that will become five-in-a-row on their next move unless ${self} blocks it right now?`,
      criteria: {
        true: `${foe} has an immediate winning threat that must be blocked this turn`,
        false: `${foe} has no threat that wins on their very next move`,
      },
    },
    }),
  };

  const started = Date.now();
  const result = await callJev({
    state,
    questions: questions as unknown as Record<string, Question>,
    signal,
  });
  // Round one only. The second pass adds its own time below.
  let latencyMs = Date.now() - started;

  const answers = result.answers as Record<string, any>;
  const best = answers.best_move;
  const probabilities: Record<string, number> = best.probabilities ?? {};

  const moveIdx = fromLabel(best.choice, size);
  if (moveIdx < 0 || board[moveIdx] !== 0) {
    // Options are legal by construction, so this means a protocol mismatch.
    throw new Error(
      `Jev returned an unusable point: ${JSON.stringify(best.choice)} (parsed index ${moveIdx}).`,
    );
  }

  // Round two. Only the candidates round one actually considered are re-asked,
  // and only when round one was not already sure. A failure here must never
  // cost Jev its move, so the round-one answer stands on any error.
  let chosen = best.choice as string;
  let chosenIdx = moveIdx;
  let verified: VerifiedCandidate[] | null = null;
  let verifySwitched = false;
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const top1 = ranked[0]?.[1] ?? 1;
  if (verify && ranked.length > 1 && top1 < VERIFY_GATE) {
    try {
      const pool = ranked
        .slice(0, VERIFY_TOP_K)
        .map(([label, p]) => ({ label, p, idx: fromLabel(label, size) }))
        .filter((c) => c.idx >= 0 && board[c.idx] === 0 && allPoints[c.label] !== undefined);
      if (pool.length > 1) {
        const out = await verifyCandidates({
          board, size, jev, history, candidates: pool,
          informed, rules, noEffects, multiAxis, doubleThreat, openingRelations, keyPoints, brief, signal,
        });
        out.sort((a, b) => b.score - a.score);
        verified = out;
        const win = out[0];
        const idx = fromLabel(win.label, size);
        if (idx >= 0 && board[idx] === 0 && win.label !== chosen) {
          chosen = win.label;
          chosenIdx = idx;
          verifySwitched = true;
        }
      }
    } catch {
      // Round one stands.
    }
    // The UI prints this as Jev's thinking time, so it has to include the pass
    // the player is actually waiting for.
    latencyMs = Date.now() - started;
  }

  // The opponent replies to the board WITH Jev's stone on it. Asking before the
  // stone lands produced predictions of Jev's own squares (see RESULTS.md), so
  // this is a second request against the real position.
  let predictedReply: string | null = null;
  let predictedReplyProbabilities: Record<string, number> | null = null;
  if (includePrediction && !bare) {
    try {
      const afterJev = board.slice() as Board;
      afterJev[chosenIdx] = jev;
      const replyPoints: Record<string, null> = {};
      for (const idx of emptyCells(afterJev)) replyPoints[toLabel(idx, size)] = null;

      const replyResult = await callJev({
        state: brief
          ? buildBriefState(afterJev, size, jev, rules)
          : buildState(afterJev, size, jev, [...history, { move: chosen, player: jev }], informed, rules, false, multiAxis, doubleThreat, openingRelations),
        questions: {
          predicted_reply: {
            type: "choice",
            instructions: {
              task: `You have just played ${chosen}. Which empty point will ${foe} play on their next turn?`,
              note: "Judge what this particular opponent is likely to actually do, which is not always the objectively best move.",
            },
            criteria: replyPoints,
          },
        } as unknown as Record<string, Question>,
        signal,
      });
      const a = replyResult.answers.predicted_reply as any;
      predictedReply = a?.choice ?? null;
      predictedReplyProbabilities = a?.probabilities ?? null;
    } catch {
      // A failed prediction must never cost Jev its move.
    }
  }

  const topMoves = Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, p]) => ({ label, p }));

  return {
    move: chosen,
    moveIdx: chosenIdx,
    probabilities,
    topMoves,
    predictedReply,
    predictedReplyProbabilities,
    position: answers.position
      ? { score: answers.position.score, probabilities: answers.position.probabilities }
      : null,
    opponentThreat: answers.opponent_threat?.probability ?? null,
    // The options actually offered, which is `empties` minus black's forbidden
    // points when Jev holds black. The UI prints this as "全盘 N 个空点中选出".
    optionCount: Object.keys(allPoints).length,
    verified,
    verifySwitched,
    latencyMs,
    usage: result.usage,
    warnings: result.warnings ?? [],
    transport: result.transport,
  };
}
