import type { Metadata } from "next";
import Link from "next/link";
import "../board.css";
import "./jev.css";

export const metadata: Metadata = {
  title: "什么是 Jev · 五子棋",
  description:
    "用最白话的方式讲清楚 Jev：一个只回答“有多少把握”的判断模型，以及这盘棋的每一手是怎么从它手里出来的。",
};

/**
 * A compact board built from the same `.demo-pt` / `.demo-stone` vocabulary as
 * rules-explainer.tsx. `extra` renders an overlay inside one point — the heat
 * wash hangs off a single intersection.
 *   X = black (you), O = white (Jev), . = empty
 */
function Mini({
  grid,
  extra,
  axes = false,
}: {
  grid: string[];
  extra?: Record<string, React.ReactNode>;
  /** Column letters along the top and row numbers down the left. */
  axes?: boolean;
}) {
  const n = grid[0].length;
  const board = (
    <div className="mini" style={{ ["--dn" as string]: n }}>
      {grid.flatMap((row, r) =>
        row.split("").map((ch, c) => {
          const edge = [
            r === 0 ? "t" : "",
            r === grid.length - 1 ? "b" : "",
            c === 0 ? "l" : "",
            c === n - 1 ? "r" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span className="demo-pt" data-edge={edge} key={`${r}-${c}`}>
              {ch !== "." && <span className="demo-stone" data-s={ch === "X" ? "1" : "2"} />}
              {extra?.[`${r}-${c}`]}
            </span>
          );
        }),
      )}
    </div>
  );
  if (!axes) return board;
  return (
    <div className="mini-axed" style={{ ["--dn" as string]: n }}>
      <div className="mini-cols" aria-hidden>
        {Array.from({ length: n }, (_, c) => (
          <span key={c}>{String.fromCharCode(65 + c)}</span>
        ))}
      </div>
      <div className="mini-rows" aria-hidden>
        {Array.from({ length: grid.length }, (_, r) => (
          <span key={r}>{r + 1}</span>
        ))}
      </div>
      {board}
    </div>
  );
}

const POSITION = [
  ".......",
  "..X....",
  "..XO...",
  "...X...",
  "....O..",
  ".......",
  ".......",
];

export default function WhatIsJev() {
  return (
    <main className="shell">
      <header className="masthead">
        <h1>什么是 Jev</h1>
        <span className="sub">说得像讲给五岁小孩听</span>
        <Link className="masthead-link" href="/">
          ← 回到棋局
        </Link>
      </header>

      <div className="prose">
        <p className="lede">
          想象一位<strong>不会说话的裁判</strong>。他不会替你想出一步棋，也写不出一个字。
          你要做的是：把整盘棋写成一张纸条，再把<strong>所有能下的点</strong>列成一张清单递过去。
          他做的事只有一件——在每一个选项旁边写下“我有多少把握”。
          这位裁判就是 Jev。这盘棋里每一手白棋，都是这样问出来的。
        </p>

        {/* ── WHAT ─────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">What · 是什么</span>
          <h2>它是一个判断模型，不是一个会写字的模型</h2>
          <p>
            平常讲的 AI 大多是<strong>生成式</strong>的：你问它，它吐出一段话。
            Jev 不是。它属于 TypeSafe 的 <strong>System One</strong> 系列——
            所谓“系统一”，就是人不假思索的那种直觉判断。
            它吃进两样东西：一份<strong>状态</strong>（现在发生了什么），
            和一组<strong>有类型的问题</strong>（你要它判断什么）；
            吐出来的永远是带着<strong>校准过的概率</strong>的答案，不是文字。
          </p>
          <p>它只会三种答法：</p>
          <div className="prim">
            <div className="prim-row">
              <span className="prim-name">choice</span>
              <span className="prim-what">从你给的选项里挑一个，并且附上每个选项各自的概率。</span>
              <span className="prim-eg">本局用途：<code>best_move</code> — 从全盘每一个空点里挑出这一手。</span>
            </div>
            <div className="prim-row">
              <span className="prim-name">boolean</span>
              <span className="prim-what">是或不是，返回的是“是”的概率，一个 0 到 1 之间的数。</span>
              <span className="prim-eg">本局用途：<code>opponent_threat</code> — 对手下一手就能成五吗？</span>
            </div>
            <div className="prim-row">
              <span className="prim-name">score</span>
              <span className="prim-what">在你排好的几个等级上打一个分，同样附概率分布。</span>
              <span className="prim-eg">本局用途：<code>position</code> — 从“黑必胜”到“白必胜”五个等级，驱动右侧那条胜率条。</span>
            </div>
          </div>
          <p>
            举个例子。就是上面那个局面，<strong>递进去</strong>的和<strong>收回来</strong>的分别长这样。
            指令写的是英文，标 <code>…</code> 的地方是真实存在、为了排版略去的内容。
          </p>
          <div className="io">
            <div className="io-col">
              <div className="io-head" data-d="in">输入 · 状态 ＋ 问题</div>
              <pre>{`state: {                    // 共 15 个字段
  board_size: "15x15",
  you_play: "white (O)",
  black_stones: ["C2", "C3", "D4"],
  white_stones: ["D3", "E5"],
  move_history: [
    "black (X) played C2",
    "white (O) played D3", …
  ],
  lines_on_board: [
    { player: "black (X)",
      stones: ["C2", "C3"],
      direction: "vertical",
      pattern: ".XX..",
      severity: "two",
      critical_points: ["C1", "C4"],
      note: "two with room to grow" }
  ],
  board_diagram: "…", point_effects: [], …
}

questions: {
  best_move: {
    type: "choice",
    instructions: {
      task: "You are playing white (O) …",
      priority_order: [ … ]
    },
    criteria: { "A1": null, "B1": null, … }
  },
  opponent_threat: {
    type: "boolean",
    instructions: "Does black (X) have a line
      that will become five-in-a-row on their
      next move unless white (O) blocks it?",
    criteria: {
      true:  "…must be blocked this turn",
      false: "…no threat that wins next move"
    }
  }
}`}</pre>
              <p className="io-note">
                <code>criteria</code> 里这一局有 <strong>220</strong> 个空点，值一律是 <code>null</code>——
                不带提示，也没有排序。
              </p>
            </div>
            <div className="io-col">
              <div className="io-head" data-d="out">输出 · 带概率的判断</div>
              <pre>{`answers: {
  best_move: {
    type: "choice",
    choice: "E2",
    probabilities: {
      "E2": 0.614,
      "B1": 0.209,
      "F6": 0.092,
      …
    }
  },
  opponent_threat: {
    type: "boolean",
    probability: 0.07
  }
}`}</pre>
              <p className="io-note">
                没有一个字的自然语言。<code>0.07</code> 就是“黑棋这手不用挡”的把握；
                <code>probabilities</code> 同样覆盖全部 220 个点。
              </p>
            </div>
          </div>
          <p>
            注意最关键的一点：它<strong>说不出一个不在清单上的点</strong>。
            选项是程序列出来的，Jev 只能在里面选。这不是限制，这是保证。
          </p>
          <p>
            还有一个直接的后果：<strong>它很快</strong>。
            它不写字，也就没有“一边想一边把推理吐成一长串”的过程——
            一次前向就把答案定下来，同一个请求里的所有问题还共用这一次推理。
            所以你在棋盘上看到的不是转圈等待，而是<strong>落子般的即答</strong>。
          </p>
        </section>

        {/* ── WHY ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">Why · 为什么</span>
          <h2>因为有些事 for 循环做不到，有些事生成式模型给不了</h2>
          <p>
            五子棋里凡是能用规则算死的——谁连成五、哪里能落子、对方下一手会不会赢——
            都交给程序，一行循环就解决，而且永远不会错。
            真正难的是<strong>取舍</strong>：对方同时有两个威胁，先挡哪一个？
            现在是该进攻还是该防守？这个形状看起来吓人，实际上危险吗？
            这种判断没有公式，正是 Jev 的位置。
          </p>
          <p>
            另一半理由是<strong>概率</strong>。生成式模型给你一个答案，却不会诚实告诉你它有多犹豫。
            Jev 每次都交回一整张分布表——所以这个网页才能把它的把握直接<strong>画在棋盘上</strong>：
            墨色越浓，它越想下那里。看得见的犹豫，才是这个项目真正想给你看的东西。
          </p>
        </section>

        {/* ── WHO ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">Who · 谁在做</span>
          <h2>谁负责什么</h2>
          <p>
            Jev 由 TypeSafe 提供。在这盘棋里，工作是这样切的——
            分界线画在哪里，就决定了对手有多强。
          </p>
          <div className="split">
            <div className="split-col">
              <div className="split-head">程序（确定性的部分）</div>
              <ul>
                <li>棋盘、落子、胜负判定</li>
                <li>列出全盘所有空点当选项</li>
                <li>用 5 格滑窗找出盘面上所有成形的线</li>
                <li>算出每个点会造成什么、挡掉什么</li>
                <li>禁手规则与犯规判定</li>
                <li>检查 Jev 选的点确实合法</li>
              </ul>
            </div>
            <div className="split-col" data-w="jev">
              <div className="split-head">Jev（判断的部分）</div>
              <ul>
                <li>这一手下哪里</li>
                <li>现在谁占优，优多少</li>
                <li>对方的威胁是不是非挡不可</li>
              </ul>
            </div>
          </div>
          <p>
            程序从不替 Jev 缩小选项。它拿到的永远是<strong>全盘每一个空点</strong>——
            开局第一手就是两百多个选择——程序只负责把盘面说清楚，不负责暗示答案。
          </p>
        </section>

        {/* ── HOW ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag" data-k="how">How · 怎么运作</span>
          <h2>一手白棋，是这样生出来的</h2>
          <p>
            你点下一颗黑子的那一瞬间，下面五件事依次发生。
            每一格下面的小动画都在循环演示那一步。
          </p>

          {/* 1 */}
          <div className="how-step">
            <span className="how-n">一</span>
            <div>
              <div className="how-title">把棋盘翻译成一张纸条</div>
              <p className="how-body">
                程序把盘面写成<strong>一组有名字的字段</strong>递过去：一张 ASCII 的棋盘图、
                黑子与白子各自的坐标清单、到目前为止的手顺、还有这局怎么算赢
                （开了禁手的话，黑棋受哪些限制也写在这里）。
                这张纸条只<strong>陈述事实</strong>，不下任何结论。
              </p>
              <div className="how-anim">
                <div className="row2">
                  <Mini grid={POSITION} axes />
                  <span className="arrow">→</span>
                  <div className="slip">
                    <span><b>board_diagram</b>: ASCII 全图</span>
                    <span><b>black_stones</b>: C2 C3 D4</span>
                    <span><b>white_stones</b>: D3 E5</span>
                    <span><b>move_history</b>: 5 手，依次</span>
                    <span><b>win_condition</b>: 五子连线</span>
                  </div>
                </div>
                <p className="anim-cap">
                  列是字母、行是数字，所以左边那颗黑子就叫 <code>C2</code>。
                  一张人看得懂、模型也读得进去的纸条。
                </p>
              </div>
            </div>
          </div>

          {/* 2 */}
          <div className="how-step">
            <span className="how-n">二</span>
            <div>
              <div className="how-title">把“关系”也一并算好写上去</div>
              <p className="how-body">
                只给坐标还不够。程序再拿一个<strong>五格宽的窗口</strong>在四个方向上滑过整张盘——
                只要某个窗口里只有一种颜色加空点，那就是一条活着的线。
                为什么是窗口而不是“连着的几颗”？因为人下棋常常跳着下：
                <code>XX.XX</code> 下一手就成五，按“连着数”却只会读成两个二。
                这一条加进去，逼着必挡的那些局面从<strong>全错变成全对</strong>。
              </p>
              <div className="how-anim">
                <div className="strip">
                  <div className="win-box" />
                  {"..XX.XX..".split("").map((ch, c) => (
                    <span
                      className="demo-pt"
                      data-edge={[c === 0 ? "l" : "", c === 8 ? "r" : ""].filter(Boolean).join(" ")}
                      key={c}
                    >
                      {ch !== "." && <span className="demo-stone" data-s="1" />}
                    </span>
                  ))}
                </div>
                <p className="anim-cap">
                  窗口停得最久的那一刻，框住的正是 <code>XX.XX</code>：四颗黑子加一个空点——
                  下一手就成五。程序同时写下它的要害点落在哪里。
                </p>
              </div>
            </div>
          </div>

          {/* 3 */}
          <div className="how-step">
            <span className="how-n">三</span>
            <div>
              <div className="how-title">所有问题，一次问完</div>
              <p className="how-body">
                纸条写好，程序把问题<strong>打包成一个请求</strong>送出去。
                这些问题彼此看不到对方的答案，它们是<strong>同时</strong>被回答的——
                所以能一起问的就绝不分两次问。只有当一个答案必须拿来组出新的状态时，才值得再跑一趟。
              </p>
              <div className="how-anim">
                <div className="fan">
                  <span className="chip">
                    best_move <em>choice · 全盘空点</em>
                  </span>
                  <span className="chip">
                    position <em>score · 五个等级</em>
                  </span>
                  <span className="chip">
                    opponent_threat <em>boolean · 要不要挡</em>
                  </span>
                </div>
                <p className="anim-cap">三个问题，一次往返。推理便宜到可以放手多问。</p>
              </div>
            </div>
          </div>

          {/* 4 */}
          <div className="how-step">
            <span className="how-n">四</span>
            <div>
              <div className="how-title">回来的不是一步棋，是一整张概率表</div>
              <p className="how-body">
                Jev 交回它选的那个点，<strong>以及每一个候选点的概率</strong>。
                这张表就是它的犹豫程度：第一名压倒性地高，代表它很确定；
                几个点挤在一起，代表这局面它也觉得难。
              </p>
              <div className="how-anim">
                <div className="pbars">
                  <span className="pbar" style={{ ["--w" as string]: "100%" }}>
                    <code>E2</code><i /><em>61.4%</em>
                  </span>
                  <span className="pbar" style={{ ["--w" as string]: "34%" }}>
                    <code>B1</code><i /><em>20.9%</em>
                  </span>
                  <span className="pbar" style={{ ["--w" as string]: "15%" }}>
                    <code>F6</code><i /><em>9.2%</em>
                  </span>
                  <span className="pbar" style={{ ["--w" as string]: "7%" }}>
                    <code>C5</code><i /><em>4.1%</em>
                  </span>
                </div>
                <p className="anim-cap">同一张表同时喂给棋盘的热区和右侧的胜率条。</p>
              </div>
            </div>
          </div>

          {/* 5 */}
          <div className="how-step">
            <span className="how-n">五</span>
            <div>
              <div className="how-title">程序先验过，才落子；概率则显影成墨色</div>
              <p className="how-body">
                类型保证了形状，不保证正确。所以程序会再确认一次：
                这个坐标解析得出来吗？那格真的是空的吗？<strong>不合法就不下</strong>。
                验过之后子才落下，同一张概率表化成深浅不同的墨晕铺在盘上——
                浓的地方就是它更想下的地方。
              </p>
              <div className="how-anim">
                <div className="row2">
                  <span className="gate">合法性复核 ✓</span>
                  <span className="arrow">→</span>
                  <Mini
                    grid={POSITION}
                    extra={{
                      "1-4": (
                        <>
                          <span className="heat" style={{ ["--o" as string]: 0.62 }} />
                          <span className="demo-stone landing" data-s="2" />
                        </>
                      ),
                      "0-1": <span className="heat" style={{ ["--o" as string]: 0.22 }} />,
                      "5-5": <span className="heat" style={{ ["--o" as string]: 0.1 }} />,
                    }}
                  />
                </div>
                <p className="anim-cap">墨晕先浮出来，白子随后落在最浓的那一点。</p>
              </div>
            </div>
          </div>

        </section>

        {/* ── HOW MUCH ─────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">How much · 多少代价</span>
          <h2>又快又便宜，所以可以放手多问</h2>
          <div className="price">
            <div className="price-cell">
              <div className="price-k">输入</div>
              <div className="price-v">$0.042<small>/ 百万 token</small></div>
            </div>
            <div className="price-cell">
              <div className="price-k">输出</div>
              <div className="price-v">免费</div>
            </div>
            <div className="price-cell">
              <div className="price-k">一手棋 · 花费</div>
              <div className="price-v">不到一分钱</div>
            </div>
            <div className="price-cell">
              <div className="price-k">一手棋 · 耗时</div>
              <div className="price-v">0.45<small>秒 · 中位</small></div>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            耗时是本机 94 手真实对局量出来的：最快 0.32 秒，中位 0.45 秒，最慢 1.16 秒。
            开局那一手最重——两百多个选项一起评——也就 0.9 秒上下。
            （线上还要加一段网络往返。）
          </p>
          <p style={{ marginTop: 14 }}>
            这个价格改变的是设计方式：既然一手棋问三十个问题也只是零头，
            就不该为了省而少问。<strong>该考虑的是怎么把问题摊开，而不是怎么节省。</strong>
          </p>
        </section>

        <div className="back-cta">
          <Link className="btn" href="/">
            回到棋局，亲自试试
          </Link>
          <span className="note">下一手落子时，注意盘上先浮出来的那层墨。</span>
        </div>
      </div>
    </main>
  );
}
