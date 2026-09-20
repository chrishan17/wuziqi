"use client";

import type { ForbiddenKind } from "@/lib/renju";

/**
 * Small static diagrams. Each is a 7-wide strip or 7x7 grid where:
 *   X = black already there, O = white, @ = the move being played (cinnabar),
 *   . = empty point.
 * Drawn with the same wood/ink vocabulary as the real board.
 */

type Demo = { title: string; grid: string[]; caption: string };

const DEMOS: Record<ForbiddenKind, Demo> = {
  doubleThree: {
    title: "三三 · 同时形成两个活三",
    grid: [
      ".......",
      "...X...",
      "...X...",
      ".XX@...",
      ".......",
      ".......",
      ".......",
    ],
    caption:
      "落在朱砂点之后，横向与纵向同时各成一个“活三”（两端都空、再一子即成活四）。黑棋此手判负。",
  },
  doubleFour: {
    title: "四四 · 同时形成两个四",
    grid: [
      "...X...",
      "...X...",
      "...X...",
      "XXX@...",
      ".......",
      ".......",
      ".......",
    ],
    caption:
      "落在朱砂点之后，横向成四、纵向也成四——两边都只差一子成五。黑棋此手判负。注意“四三”（一个四加一个活三）是合法的，那是连珠的致胜手。",
  },
  overline: {
    title: "长连 · 六子以上连成一线",
    grid: [
      ".......",
      ".......",
      ".......",
      "XXX@XX.",
      ".......",
      ".......",
      ".......",
    ],
    caption:
      "落在朱砂点之后连成六子。黑棋只能以“恰好五子”获胜，六子以上判负。白棋不受此限，六子照样算赢。",
  },
};

function Diagram({ grid }: { grid: string[] }) {
  const n = grid[0].length;
  return (
    <div className="demo" style={{ ["--dn" as string]: n }}>
      {grid.flatMap((row, r) =>
        row.split("").map((ch, c) => {
          const edge = [
            r === 0 ? "t" : "", r === grid.length - 1 ? "b" : "",
            c === 0 ? "l" : "", c === n - 1 ? "r" : "",
          ].filter(Boolean).join(" ");
          return (
            <span className="demo-pt" data-edge={edge} key={`${r}-${c}`}>
              {ch !== "." && (
                <span className="demo-stone" data-s={ch === "@" ? "at" : ch === "X" ? "1" : "2"} />
              )}
            </span>
          );
        }),
      )}
    </div>
  );
}

export function RulesExplainer({ kind }: { kind: ForbiddenKind }) {
  const d = DEMOS[kind];
  return (
    <div className="explain">
      <div className="explain-head">{d.title}</div>
      <Diagram grid={d.grid} />
      <p className="explain-legend">朱砂子＝正在落的这一手</p>
      <p className="explain-body">{d.caption}</p>
    </div>
  );
}

/** 禁手 binds black, whoever is holding it — the text has to follow the seat. */
export const FORBIDDEN_INTRO = (humanIsBlack: boolean) =>
  humanIsBlack
    ? "禁手只约束黑棋（你）。黑棋先行占优，禁手是用来抵消这个优势的；白棋（Jev）不受任何限制。踩中禁手立即判负。"
    : "禁手只约束黑棋（Jev）。黑棋先行占优，禁手是用来抵消这个优势的；你执白，不受任何限制。Jev 踩中禁手即判负。";
