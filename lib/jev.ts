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
import { pointEffects } from "./effects";
import { enumerateLines } from "./lines";
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
) {
  const { self, foe } = describe(jev);
  const lastCols = "A".charCodeAt(0);
  return {
    game: "Gomoku (five-in-a-row), free-style rules, no forbidden moves",
    board_size: `${size}x${size}`,
    coordinates: `Columns are letters ${String.fromCharCode(lastCols)}-${String.fromCharCode(
      lastCols + size - 1,
    )} from left to right. Rows are numbers 1-${size} from top to bottom. A point is written as column then row, for example ${toLabel(
      Math.floor((size * size) / 2),
      size,
    )} is the centre of the board.`,
    win_condition: rules && (rules.overline || rules.doubleThree || rules.doubleFour)
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
    stones_on_board: history.length,
    ...(withLines
      ? {
          lines_on_board: enumerateLines(board, size, 2),
          lines_note:
            "Every run of two or more stones already on the board, longest first, with the empty points at each end.",
        }
      : {}),
    // Only present when 禁手 is active. States what black is barred from doing;
    // it names no move and draws no conclusion.
    // What each nearby point would create, for white and against black. Points
    // carrying both fields are the ones that attack while defending.
    ...(withLines && !noEffects
      ? {
          point_effects: pointEffects(board, size, jev, multiAxis),
          point_effects_note: multiAxis
            ? "For each nearby empty point: what it builds for you, which opponent threat it answers, and `builds_on` — every direction it builds in. A point may do all three. A point listed with more than one direction lies on two of your lines at once."
            : "For each nearby empty point: what it builds for you, and which opponent threat it answers. A point may do both.",
        }
      : {}),
    ...(withLines && rules ? (() => {
      const fa = analyseForbidden(board, size, rules);
      return fa ? { forbidden_analysis: fa } : {};
    })() : {}),
  };
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
  /** Active 禁手 rules, passed through to the state. */
  rules?: Rules;
  /** Drop `point_effects` only, keeping everything else. For measurement. */
  noEffects?: boolean;
  /** Override the priority ladder sent with `informed`. Defaults to `PRIORITY`. */
  priority?: string[];
  /** Add `builds_on` to `point_effects`. Measured in scripts/colour-check.ts. */
  multiAxis?: boolean;
  signal?: AbortSignal;
}): Promise<MoveTrace> {
  const { board, size, jev, history, includePrediction = false, bare = false, informed = false, rules, noEffects = false, priority = PRIORITY, multiAxis = false, signal } = opts;
  const { self, foe } = describe(jev);

  const empties = emptyCells(board);
  if (empties.length === 0) throw new Error("No legal moves: the board is full.");

  // Every empty point, unfiltered and unranked. Null description = no hint.
  //
  // The ONE exception, and it is Layer 0 rather than candidate filtering: when
  // Jev plays BLACK under 禁手, a forbidden point is an instant loss, so it is
  // not a legal move at all and never reaches the option set. This is not the
  // "remove forbidden points from Jev's options" idea CLAUDE.md rejects — that
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

  const state = buildState(board, size, jev, history, informed, rules, noEffects, multiAxis);

  const questions = {
    // The only question that decides play. Everything else is observation.
    best_move: {
      type: "choice" as const,
      instructions: {
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
  const latencyMs = Date.now() - started;

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

  // The opponent replies to the board WITH Jev's stone on it. Asking before the
  // stone lands produced predictions of Jev's own squares (see RESULTS.md), so
  // this is a second request against the real position.
  let predictedReply: string | null = null;
  let predictedReplyProbabilities: Record<string, number> | null = null;
  if (includePrediction && !bare) {
    try {
      const afterJev = board.slice() as Board;
      afterJev[moveIdx] = jev;
      const replyPoints: Record<string, null> = {};
      for (const idx of emptyCells(afterJev)) replyPoints[toLabel(idx, size)] = null;

      const replyResult = await callJev({
        state: buildState(afterJev, size, jev, [...history, { move: best.choice, player: jev }], informed, rules, false, multiAxis),
        questions: {
          predicted_reply: {
            type: "choice",
            instructions: {
              task: `You have just played ${best.choice}. Which empty point will ${foe} play on their next turn?`,
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
    move: best.choice,
    moveIdx,
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
    latencyMs,
    usage: result.usage,
    warnings: result.warnings ?? [],
    transport: result.transport,
  };
}
