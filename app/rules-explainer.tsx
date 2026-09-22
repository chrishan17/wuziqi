"use client";

import type { ForbiddenKind } from "@/lib/renju";
import type { Lang } from "@/lib/i18n";

/**
 * Small static diagrams. Each is a 7-wide strip or 7x7 grid where:
 *   X = black already there, O = white, @ = the move being played (cinnabar),
 *   . = empty point.
 * Drawn with the same wood/ink vocabulary as the real board.
 */

type Demo = { title: string; grid: string[]; caption: string; titleEn: string; captionEn: string };

const DEMOS: Record<ForbiddenKind, Demo> = {
  doubleThree: {
    title: "三三 · 同时形成两个活三",
    titleEn: "Double three · two open threes at once",
    captionEn:
      "After the cinnabar stone, the row and the column each hold an open three (both ends empty, one stone from an open four). Black loses on this move.",
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
    titleEn: "Double four · two fours at once",
    captionEn:
      "After the cinnabar stone, the row and the column are each a four — one stone from five. Black loses on this move. A four plus an open three (4-3) is legal: that is Renju's winning shape.",
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
    titleEn: "Overline · six or more in a row",
    captionEn:
      "After the cinnabar stone, black has six in a row. Black wins only with exactly five; six or more loses. White has no such limit.",
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

export function RulesExplainer({ kind, lang = "en" }: { kind: ForbiddenKind; lang?: Lang }) {
  const d = DEMOS[kind];
  const zh = lang === "zh";
  return (
    <div className="explain">
      <div className="explain-head">{zh ? d.title : d.titleEn}</div>
      <Diagram grid={d.grid} />
      <p className="explain-legend">{zh ? "朱砂子＝正在落的这一手" : "Cinnabar stone = the move being played"}</p>
      <p className="explain-body">{zh ? d.caption : d.captionEn}</p>
    </div>
  );
}

/** 禁手 binds black, whoever is holding it — the text has to follow the seat. */
export const FORBIDDEN_INTRO = (humanIsBlack: boolean, lang: Lang = "en") =>
  lang === "zh"
    ? humanIsBlack
      ? "禁手只约束黑棋（你）。黑棋先行占优，禁手是用来抵消这个优势的；白棋（Jev）不受任何限制。踩中禁手立即判负。"
      : "禁手只约束黑棋（Jev）。黑棋先行占优，禁手是用来抵消这个优势的；你执白，不受任何限制。Jev 踩中禁手即判负。"
    : humanIsBlack
      ? "Forbidden moves bind black only — you. Moving first is an advantage, and these rules offset it; white (Jev) has no restrictions. Playing a forbidden point loses at once."
      : "Forbidden moves bind black only — Jev. Moving first is an advantage, and these rules offset it; you play white and have no restrictions. If Jev plays a forbidden point, it loses.";
