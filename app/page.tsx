"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import {
  type Board,
  type Player,
  DEFAULT_SIZE,
  applyMove,
  createBoard,
  fromLabel,
  isWinningMove,
  toLabel,
} from "@/lib/board";
import { placeHandicap } from "@/lib/opponent";
import type { HistoryEntry, MoveTrace } from "@/lib/jev";
import {
  FREESTYLE,
  RULE_NAME,
  forbiddenPoints,
  outcomeOf,
  type ForbiddenKind,
  type Rules,
} from "@/lib/renju";
import { RulesExplainer, FORBIDDEN_INTRO } from "./rules-explainer";
import "./board.css";

const SIZE = DEFAULT_SIZE;
const BLACK: Player = 1;
const WHITE: Player = 2;
const other = (p: Player): Player => (p === BLACK ? WHITE : BLACK);

/** 星位 for a 15x15 board, 0-indexed. */
const STARS = new Set(
  [
    [3, 3], [3, 11], [11, 3], [11, 11], [7, 7],
  ].map(([c, r]) => r * SIZE + c),
);

type Status =
  | "playing"
  | "human-won"
  | "jev-won"
  | "draw"
  | "human-forbidden"
  | "jev-forbidden";
type Splash = { idx: number; key: number };

const FORBIDDEN_ROWS: Array<[keyof Rules, string, string]> = [
  ["doubleThree", "三三", "同时形成两个活三"],
  ["doubleFour", "四四", "同时形成两个四"],
  ["overline", "长连", "六子以上连成一线"],
];

/** Keyframe landmarks of `hand-place` (0.9s): the hand reaches the point at 52%,
    and is fully withdrawn at 100%. `setBoard` is held back to HAND_REACH so the
    stone is not already sitting there when the hand arrives. */
const HAND_TOTAL = 900;
const HAND_REACH = 480;
/** How long the probability wash sits on the board on its own, before the hand
    comes in. Long enough to actually read the distribution. */
const HEAT_DWELL = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Page() {
  const [handicap, setHandicap] = useState(0);
  /** Which colour the human holds. Black opens, so this is the 先/后手 switch. */
  const [humanColor, setHumanColor] = useState<Player>(BLACK);
  const jevColor = other(humanColor);
  const [rules, setRules] = useState<Rules>(FREESTYLE);
  /** 素盘: tell Jev only the game, its colour, the board, and whether 禁手 is on. */
  const [brief, setBrief] = useState(false);
  const [brokeRule, setBrokeRule] = useState<ForbiddenKind | null>(null);
  const [board, setBoard] = useState<Board>(() => createBoard(SIZE));
  // Tagged, not bare labels: `normaliseHistory` in lib/jev.ts infers strict
  // alternation from black for untagged entries, which is wrong the moment the
  // human takes white or a handicap stone is seeded.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [trace, setTrace] = useState<MoveTrace | null>(null);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<Status>("playing");
  const [error, setError] = useState<string | null>(null);
  const [lastIdx, setLastIdx] = useState(-1);
  const [winLine, setWinLine] = useState<Set<number>>(new Set());
  const [splash, setSplash] = useState<Splash | null>(null);
  const splashKey = useRef(0);
  // Jev's hand: which intersection it is reaching for, null when off-board.
  const [hand, setHand] = useState<number | null>(null);
  const handShown = useRef(false);
  // Bumped on every reset. An in-flight Jev turn compares against it after each
  // await and bails if the game it belongs to is gone — the colour/handicap/rule
  // buttons stay live while Jev is thinking, and Jev now also opens on reset.
  const gen = useRef(0);

  // Clear the ink bloom once it has dried, so a repeat tap re-triggers it.
  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => setSplash(null), 1200);
    return () => clearTimeout(t);
  }, [splash]);

  function bloom(idx: number) {
    splashKey.current += 1;
    setSplash({ idx, key: splashKey.current });
  }

  /** The five (or more) stones that completed the line, for the glow. */
  function findWinLine(b: Board, idx: number): Set<number> {
    const p = b[idx];
    const c0 = idx % SIZE, r0 = Math.floor(idx / SIZE);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const line = [idx];
      for (const sign of [1, -1]) {
        let c = c0 + dx * sign, r = r0 + dy * sign;
        while (c >= 0 && c < SIZE && r >= 0 && r < SIZE && b[r * SIZE + c] === p) {
          line.push(r * SIZE + c); c += dx * sign; r += dy * sign;
        }
      }
      if (line.length >= 5) return new Set(line);
    }
    return new Set();
  }

  /** Jev's half of a turn. Takes the position explicitly — never reads state. */
  async function jevTurn(
    boardNow: Board,
    historyNow: HistoryEntry[],
    jev: Player,
    rulesNow: Rules,
    briefNow: boolean,
  ) {
    const mine = gen.current;
    const alive = () => gen.current === mine;

    setThinking(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: boardNow, history: historyNow, jev, rules: rulesNow, brief: briefNow }),
      });
      const data = await res.json();
      if (!alive()) return;
      if (!res.ok) return setError(data.error ?? "请求失败");

      const t: MoveTrace = data.trace;
      const afterJev = applyMove(boardNow, t.moveIdx, jev);

      // Show the thinking before the move: the wash goes down first, on a board
      // that is still empty at the target, so the chosen point lights up at full
      // strength. Then the hand comes in and covers it with the stone.
      setTrace(t);
      if (!reducedMotion()) await sleep(HEAT_DWELL);
      if (!alive()) return;

      // The hand travels first and the stone lands under it. Placing the stone
      // immediately and waving a hand over it afterwards is theatre nobody
      // believes. `thinking` is still true here, so the board stays disabled.
      if (!reducedMotion()) {
        handShown.current = true;
        setHand(t.moveIdx);
        await sleep(HAND_REACH);
        if (!alive()) return;
      }

      setBoard(afterJev);
      setHistory([...historyNow, { move: t.move, player: jev }]);
      setLastIdx(t.moveIdx);
      bloom(t.moveIdx);
      if (data.forbidden) {
        // Only reachable with Jev on black under 禁手. The server already keeps
        // those points out of the option set, so this is the backstop.
        setBrokeRule(data.forbidden as ForbiddenKind);
        setStatus("jev-forbidden");
      } else if (data.won) {
        setWinLine(findWinLine(afterJev, t.moveIdx));
        setStatus("jev-won");
      } else if (afterJev.every((c) => c !== 0)) setStatus("draw");
    } catch (e: any) {
      if (alive()) setError(e?.message ?? "网络错误");
    } finally {
      if (handShown.current) await sleep(HAND_TOTAL - HAND_REACH);
      handShown.current = false;
      if (alive()) {
        setHand(null);
        setThinking(false);
      }
    }
  }

  async function play(idx: number) {
    if (status !== "playing" || thinking || board[idx] !== 0) return;
    setError(null);

    const verdict = outcomeOf(board, SIZE, idx, humanColor, rules);
    const afterHuman = applyMove(board, idx, humanColor);
    const nextHistory: HistoryEntry[] = [...history, { move: toLabel(idx, SIZE), player: humanColor }];
    setBoard(afterHuman);
    setHistory(nextHistory);
    setTrace(null);
    setLastIdx(idx);
    bloom(idx);

    if (verdict.kind === "forbidden") {
      // The stone is placed so the player sees exactly where they broke it,
      // then the game ends. Jev is not consulted.
      setBrokeRule(verdict.rule);
      setStatus("human-forbidden");
      return;
    }
    if (verdict.kind === "win") {
      setWinLine(findWinLine(afterHuman, idx));
      setStatus("human-won");
      return;
    }
    if (afterHuman.every((c) => c !== 0)) return setStatus("draw");

    await jevTurn(afterHuman, nextHistory, jevColor, rules, brief);
  }

  function reset(h = handicap, colour: Player = humanColor, r: Rules = rules, b = brief) {
    gen.current += 1;
    const start = h > 0 ? placeHandicap(createBoard(SIZE), SIZE, colour, h) : createBoard(SIZE);
    const seeded: HistoryEntry[] = [];
    for (let i = 0; i < start.length; i++) {
      if (start[i] === colour) seeded.push({ move: toLabel(i, SIZE), player: colour });
    }
    setHandicap(h);
    setHumanColor(colour);
    setBoard(start);
    setHistory(seeded);
    setTrace(null);
    setStatus("playing");
    setError(null);
    setLastIdx(-1);
    setWinLine(new Set());
    setSplash(null);
    handShown.current = false;
    setHand(null);
    setBrokeRule(null);
    setThinking(false);
    // Black opens. If that is Jev, it moves before the human gets a turn.
    if (other(colour) === BLACK) void jevTurn(start, seeded, BLACK, r, b);
  }

  function chooseBrief(next: boolean) {
    setBrief(next);
    reset(handicap, humanColor, rules, next);
  }

  function toggleRule(k: keyof Rules) {
    // Changing the ruleset mid-game would make earlier moves incoherent.
    const next = { ...rules, [k]: !rules[k] };
    setRules(next);
    reset(handicap, humanColor, next);
  }

  const anyRule = rules.doubleThree || rules.doubleFour || rules.overline;
  // Shown in the collapsed fold's summary, so folding away the checkboxes does not
  // hide which rules are live.
  // RULE_NAME carries the "…禁手" suffix (for "踩中三三禁手"), which would read
  // "禁手 · 三三禁手" in the summary — use the short labels instead.
  const activeRuleNames = FORBIDDEN_ROWS.filter(([k]) => rules[k])
    .map(([, name]) => name)
    .join("、");
  // 禁手 binds black only. The crosses say 落此判负 to whoever is clicking, so
  // they are drawn only when the human holds black; when Jev holds black the
  // constraint is real but it is Jev's problem, and the server enforces it.
  const banned = useMemo<Map<number, ForbiddenKind>>(
    () =>
      anyRule && status === "playing" && humanColor === BLACK
        ? forbiddenPoints(board, SIZE, rules)
        : new Map<number, ForbiddenKind>(),
    [board, rules, anyRule, status, humanColor],
  );

  const maxP = trace?.probabilities
    ? Math.max(...Object.values(trace.probabilities), 1e-9)
    : 0;

  return (
    <main className="shell">
      <header className="masthead">
        <h1>五子棋</h1>
        <span className="sub">对弈 Jev</span>
        <Link className="masthead-link" href="/what-is-jev">
          什么是 Jev
        </Link>
      </header>

      <div className="field">
        <div className="goban-wrap">
          <div className="goban" style={{ ["--n" as string]: SIZE }}>
            <div className="grid">
              {board.map((v, i) => {
                const c = i % SIZE, r = Math.floor(i / SIZE);
                const edge = [
                  r === 0 ? "t" : "", r === SIZE - 1 ? "b" : "",
                  c === 0 ? "l" : "", c === SIZE - 1 ? "r" : "",
                ].filter(Boolean).join(" ");
                const label = toLabel(i, SIZE);
                const p = trace?.probabilities?.[label] ?? 0;
                const a = v === 0 && maxP > 0 ? Math.min(0.62, Math.sqrt(p / maxP) * 0.62) : 0;
                return (
                  <button
                    key={i}
                    className="pt"
                    data-edge={edge}
                    onClick={() => play(i)}
                    disabled={status !== "playing" || thinking || v !== 0}
                    aria-label={`${label}${v === 1 ? " 黑" : v === 2 ? " 白" : ""}`}
                    title={
                      banned.has(i)
                        ? `${label} · ${RULE_NAME[banned.get(i)!]}，落此判负`
                        : p > 0.005
                          ? `${label} · Jev ${(p * 100).toFixed(1)}%`
                          : label
                    }
                  >
                    {STARS.has(i) && v === 0 && <span className="star" />}
                    {a > 0.03 && <span className="wash" style={{ ["--a" as string]: a }} />}
                    {v === 0 && banned.has(i) && <span className="forbidden-mark" />}
                    {v === 0 && status === "playing" && !thinking && !banned.has(i) && (
                      <span className="hover-mark" />
                    )}
                    {splash?.idx === i && (
                      <>
                        <span className="bloom" key={`b${splash.key}`} />
                        <span className="bloom2" key={`c${splash.key}`} />
                      </>
                    )}
                    {v !== 0 && (
                      <span
                        className="stone"
                        data-p={v}
                        data-last={i === lastIdx && !winLine.size ? 1 : 0}
                        data-win={winLine.has(i) ? 1 : 0}
                        data-forbidden={
                          (status === "human-forbidden" || status === "jev-forbidden") &&
                          i === lastIdx
                            ? 1
                            : 0
                        }
                      />
                    )}
                  </button>
                );
              })}

              {hand !== null && (
                <div
                  className="hand"
                  data-target={hand}
                  style={{
                    ["--hc" as string]: hand % SIZE,
                    ["--hr" as string]: Math.floor(hand / SIZE),
                  }}
                >
                  <img
                    className="hand-img"
                    src={`${BASE_PATH}/jev-hand.png`}
                    width={700}
                    height={765}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span className="hand-stone stone" data-p={jevColor} />
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="panel">
          <div className="card">
            <div className="status-head">
            {status === "playing" ? (
              <>
                <h2>
                  <span className="turn-dot" data-w={thinking ? "think" : String(humanColor)} />
                  {thinking ? "Jev 运思" : "请落子"}
                </h2>
                <div className="meta">
                  {humanColor === BLACK ? "你执黑先行" : "你执白后行"} · 已下 {history.length} 手
                  {trace ? ` · ${trace.latencyMs}ms` : ""}
                </div>
              </>
            ) : (
              <>
                <p
                  className="verdict"
                  data-r={
                    status === "human-won" || status === "jev-forbidden"
                      ? "win"
                      : status === "draw"
                        ? ""
                        : "lose"
                  }
                >
                  {status === "human-won" || status === "jev-forbidden"
                    ? "你胜"
                    : status === "jev-won"
                      ? "Jev 胜"
                      : status === "human-forbidden"
                        ? "你负"
                        : "和局"}
                </p>
                <div className="meta">
                  {brokeRule && (status === "human-forbidden" || status === "jev-forbidden")
                    ? `${status === "human-forbidden" ? "你" : "Jev"}踩中${RULE_NAME[brokeRule]} · 共 ${history.length} 手`
                    : `共 ${history.length} 手`}
                </div>
              </>
            )}
            </div>
            <div className="dial dial--wide">
              <button className="btn" onClick={() => reset(handicap)}>重新开局</button>
            </div>
          </div>

          <div className="card">
            <h2>对局</h2>
            <div className="meta">执黑先行。换手即开新局。</div>
            <div className="dial">
              {([BLACK, WHITE] as Player[]).map((c) => (
                <button
                  key={c}
                  className="btn"
                  data-on={c === humanColor ? 1 : 0}
                  onClick={() => reset(handicap, c)}
                >
                  {c === BLACK ? "执黑 · 先" : "执白 · 后"}
                </button>
              ))}
            </div>
            <div className="meta" style={{ marginTop: 11 }}>让一子：先替你占住天元</div>
            <div className="dial">
              {[0, 1].map((h) => (
                <button
                  key={h}
                  className="btn"
                  data-on={h === handicap ? 1 : 0}
                  onClick={() => reset(h)}
                >
                  {h === 0 ? "对等" : "让一子"}
                </button>
              ))}
            </div>
            <div className="meta" style={{ marginTop: 11 }}>告诉 Jev。换了即开新局。</div>
            <div className="dial">
              <button className="btn" data-on={brief ? 0 : 1} onClick={() => chooseBrief(false)}>
                详注
              </button>
              <button className="btn" data-on={brief ? 1 : 0} onClick={() => chooseBrief(true)}>
                素盘
              </button>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              {brief
                ? "只说这是五子棋、Jev 执哪一方、当前盘面、有没有禁手。"
                : "连同盘上的线、落点的作用、先后手的取舍，一并告诉它。"}
            </div>

            {/* Uncontrolled on purpose: `rules` always starts FREESTYLE, so the fold
                starts closed, and an `open={anyRule}` prop would slam it shut under
                the user the moment they unticked the last rule. */}
            <details className="fold">
              <summary>
                <span className="fold-name">禁手</span>
                <span className="fold-state">{activeRuleNames || "未启用"}</span>
              </summary>
            <div className="meta">{FORBIDDEN_INTRO(humanColor === BLACK)}</div>
            <div style={{ marginTop: 10 }}>
              {FORBIDDEN_ROWS.map(([k, name, hint]) => (
                <div key={k}>
                  <label className="rule-row">
                    <input type="checkbox" checked={rules[k]} onChange={() => toggleRule(k)} />
                    <span>
                      <span className="rule-name">{name}</span>
                      <span className="rule-hint">{hint}</span>
                    </span>
                  </label>
                  {rules[k] && <RulesExplainer kind={k as ForbiddenKind} />}
                </div>
              ))}
            </div>
            {anyRule && (
              <div className="meta" style={{ marginTop: 8 }}>
                {humanColor === BLACK
                  ? "棋盘上的朱砂叉即为禁手点，切换规则会立即开新局。"
                  : "你执白，不受禁手约束；受约束的是 Jev，所以盘上不画朱砂叉。切换规则会立即开新局。"}
              </div>
            )}
            </details>
          </div>

          {error && (
            <div className="card alarm">
              <h2>出错</h2>
              <div className="meta">{error}</div>
            </div>
          )}

          {trace && (
            <div className="card">
              <h2>{trace.move}</h2>
              <div className="meta">
                Jev 此手 · 全盘 {trace.optionCount} 个空点中选出 · {brief ? "素盘" : "详注"}
              </div>

              <div className="bars">
                {trace.topMoves.slice(0, 6).map((m) => (
                  <div className="bar-row" key={m.label}>
                    <code>{m.label}</code>
                    <span className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${(m.p / (trace.topMoves[0]?.p || 1)) * 100}%` }}
                      />
                    </span>
                    <span className="pct">{(m.p * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>

              {trace.position && (
                <div className="scale">
                  <div className="scale-track">
                    <span
                      className="scale-pin"
                      style={{ left: `${Math.max(2, Math.min(98, (trace.position.score / 4) * 100))}%` }}
                    />
                  </div>
                  <div className="scale-ends">
                    <span>你优</span>
                    <span>均势</span>
                    <span>Jev 优</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

    </main>
  );
}
