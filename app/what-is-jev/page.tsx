import type { Metadata } from "next";
import Link from "next/link";
import { L, LangSwitch } from "@/lib/i18n";
import "../board.css";
import "./jev.css";

export const metadata: Metadata = {
  title: "What is Jev? · Gomoku",
  description:
    "Jev in the plainest terms: a judgment model that only ever answers “how sure am I?”, and how every move in this game comes out of it.",
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

/** The request body is shared between languages; only its one comment is translated. */
const STATE_REST = `
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
}`;

export default function WhatIsJev() {
  return (
    <main className="shell">
      <header className="masthead">
        <h1>
          <L en="What is Jev?" zh="什么是 Jev" />
        </h1>
        <span className="sub">
          <L en="explained as if to a five-year-old" zh="说得像讲给五岁小孩听" />
        </span>
        <Link className="masthead-link" href="/">
          <L en="← Back to the game" zh="← 回到棋局" />
        </Link>
        <LangSwitch />
      </header>

      <div className="prose">
        <p className="lede">
          <L
            en={
              <>
                Imagine a <strong>judge who cannot speak</strong>. He will not think up a move for
                you, and he cannot write a single word. Your part is to write the whole board down on
                a slip of paper, then hand it over with a list of <strong>every point where a stone
                could go</strong>. He does exactly one thing: beside each option he writes down how
                sure he is. That judge is Jev. Every white move in this game comes from asking him in
                exactly this way.
              </>
            }
            zh={
              <>
                想象一位<strong>不会说话的裁判</strong>。他不会替你想出一步棋，也写不出一个字。
                你要做的是：把整盘棋写成一张纸条，再把<strong>所有能下的点</strong>列成一张清单递过去。
                他做的事只有一件——在每一个选项旁边写下“我有多少把握”。
                这位裁判就是 Jev。这盘棋里每一手白棋，都是这样问出来的。
              </>
            }
          />
        </p>

        {/* ── WHAT ─────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">
            <L en="What" zh="What · 是什么" />
          </span>
          <h2>
            <L
              en="A model that judges, not a model that writes"
              zh="它是一个判断模型，不是一个会写字的模型"
            />
          </h2>
          <p>
            <L
              en={
                <>
                  Most of what people call AI is <strong>generative</strong>: you ask, and it
                  produces a passage of text. Jev is not. It belongs to TypeSafe&rsquo;s{" "}
                  <strong>System One</strong> family — “System One” being the kind of snap,
                  intuitive judgment a person makes without stopping to think. It takes in two
                  things: a <strong>state</strong> (what is happening right now) and a set of{" "}
                  <strong>typed questions</strong> (what you want it to judge). What comes out is
                  always answers carrying <strong>calibrated probabilities</strong>, never text.
                </>
              }
              zh={
                <>
                  平常讲的 AI 大多是<strong>生成式</strong>的：你问它，它吐出一段话。
                  Jev 不是。它属于 TypeSafe 的 <strong>System One</strong> 系列——
                  所谓“系统一”，就是人不假思索的那种直觉判断。
                  它吃进两样东西：一份<strong>状态</strong>（现在发生了什么），
                  和一组<strong>有类型的问题</strong>（你要它判断什么）；
                  吐出来的永远是带着<strong>校准过的概率</strong>的答案，不是文字。
                </>
              }
            />
          </p>
          <p>
            <L en="It can answer in only three ways:" zh="它只会三种答法：" />
          </p>
          <div className="prim">
            <div className="prim-row">
              <span className="prim-name">choice</span>
              <span className="prim-what">
                <L
                  en="Picks one of the options you give it, and attaches a probability to every option."
                  zh="从你给的选项里挑一个，并且附上每个选项各自的概率。"
                />
              </span>
              <span className="prim-eg">
                <L
                  en={
                    <>
                      In this game: <code>best_move</code> — picks this move from every empty point
                      on the board.
                    </>
                  }
                  zh={
                    <>
                      本局用途：<code>best_move</code> — 从全盘每一个空点里挑出这一手。
                    </>
                  }
                />
              </span>
            </div>
            <div className="prim-row">
              <span className="prim-name">boolean</span>
              <span className="prim-what">
                <L
                  en="Yes or no. It returns the probability of “yes”, a number between 0 and 1."
                  zh="是或不是，返回的是“是”的概率，一个 0 到 1 之间的数。"
                />
              </span>
              <span className="prim-eg">
                <L
                  en={
                    <>
                      In this game: <code>opponent_threat</code> — can the opponent make five on
                      their next move?
                    </>
                  }
                  zh={
                    <>
                      本局用途：<code>opponent_threat</code> — 对手下一手就能成五吗？
                    </>
                  }
                />
              </span>
            </div>
            <div className="prim-row">
              <span className="prim-name">score</span>
              <span className="prim-what">
                <L
                  en="Scores the position on a set of levels you have put in order, again with a probability distribution."
                  zh="在你排好的几个等级上打一个分，同样附概率分布。"
                />
              </span>
              <span className="prim-eg">
                <L
                  en={
                    <>
                      In this game: <code>position</code> — five levels, from “black is sure to win”
                      to “white is sure to win”. It drives the win-probability bar on the right.
                    </>
                  }
                  zh={
                    <>
                      本局用途：<code>position</code> — 从“黑必胜”到“白必胜”五个等级，驱动右侧那条胜率条。
                    </>
                  }
                />
              </span>
            </div>
          </div>
          <p>
            <L
              en={
                <>
                  Here is an example, for the position pictured in step one below: what gets{" "}
                  <strong>sent in</strong>, and what <strong>comes back</strong>. The instructions
                  are written in English; wherever you see <code>…</code>, real content has been left
                  out to fit the page.
                </>
              }
              zh={
                <>
                  举个例子。就是上面那个局面，<strong>递进去</strong>的和<strong>收回来</strong>的分别长这样。
                  指令写的是英文，标 <code>…</code> 的地方是真实存在、为了排版略去的内容。
                </>
              }
            />
          </p>
          <div className="io">
            <div className="io-col">
              <div className="io-head" data-d="in">
                <L en="In · state + questions" zh="输入 · 状态 ＋ 问题" />
              </div>
              <pre>
                {"state: {                    // "}
                <L en="15 fields in all" zh="共 15 个字段" />
                {STATE_REST}
              </pre>
              <p className="io-note">
                <L
                  en={
                    <>
                      In this game <code>criteria</code> holds <strong>220</strong> empty points, and
                      every value is <code>null</code> — no hints, and no ranking.
                    </>
                  }
                  zh={
                    <>
                      <code>criteria</code> 里这一局有 <strong>220</strong> 个空点，值一律是 <code>null</code>——
                      不带提示，也没有排序。
                    </>
                  }
                />
              </p>
            </div>
            <div className="io-col">
              <div className="io-head" data-d="out">
                <L en="Out · judgments with probabilities" zh="输出 · 带概率的判断" />
              </div>
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
                <L
                  en={
                    <>
                      Not one word of natural language. <code>0.07</code> is Jev saying, as a number,
                      how sure it is that black needs no block this move; <code>probabilities</code>{" "}
                      likewise covers all 220 points.
                    </>
                  }
                  zh={
                    <>
                      没有一个字的自然语言。<code>0.07</code> 就是“黑棋这手不用挡”的把握；
                      <code>probabilities</code> 同样覆盖全部 220 个点。
                    </>
                  }
                />
              </p>
            </div>
          </div>
          <p>
            <L
              en={
                <>
                  The most important thing to notice: it <strong>cannot name a point that is not on
                  the list</strong>. The program lists the options, and Jev can only choose among
                  them. That is not a limitation; it is a guarantee.
                </>
              }
              zh={
                <>
                  注意最关键的一点：它<strong>说不出一个不在清单上的点</strong>。
                  选项是程序列出来的，Jev 只能在里面选。这不是限制，这是保证。
                </>
              }
            />
          </p>
          <p>
            <L
              en={
                <>
                  There is a direct consequence too: <strong>it is fast</strong>. Because it writes
                  nothing, there is no stage of thinking while spelling its reasoning out as a long
                  stream of text. A single forward pass settles the answer, and every question in the
                  same request shares that one pass. So what you see on the board is not a spinner
                  but an <strong>answer as prompt as a stone being placed</strong>.
                </>
              }
              zh={
                <>
                  还有一个直接的后果：<strong>它很快</strong>。
                  它不写字，也就没有“一边想一边把推理吐成一长串”的过程——
                  一次前向就把答案定下来，同一个请求里的所有问题还共用这一次推理。
                  所以你在棋盘上看到的不是转圈等待，而是<strong>落子般的即答</strong>。
                </>
              }
            />
          </p>
        </section>

        {/* ── WHY ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">
            <L en="Why" zh="Why · 为什么" />
          </span>
          <h2>
            <L
              en="Because some things a for loop cannot do, and some things a generative model cannot give you"
              zh="因为有些事 for 循环做不到，有些事生成式模型给不了"
            />
          </h2>
          <p>
            <L
              en={
                <>
                  Everything in gomoku (<span className="nw">五子棋</span>, five-in-a-row) that the rules can settle outright —
                  who has made five, where a stone may go, whether the opponent wins on the next move
                  — is handed to the program. A loop solves it, and never gets it wrong. The hard
                  part is <strong>weighing one thing against another</strong>: the opponent has two
                  threats at once, so which do you block first? Is this the moment to attack or to
                  defend? This shape looks frightening, but is it actually dangerous? Judgments like
                  these have no formula, and that is where Jev comes in.
                </>
              }
              zh={
                <>
                  五子棋里凡是能用规则算死的——谁连成五、哪里能落子、对方下一手会不会赢——
                  都交给程序，一行循环就解决，而且永远不会错。
                  真正难的是<strong>取舍</strong>：对方同时有两个威胁，先挡哪一个？
                  现在是该进攻还是该防守？这个形状看起来吓人，实际上危险吗？
                  这种判断没有公式，正是 Jev 的位置。
                </>
              }
            />
          </p>
          <p>
            <L
              en={
                <>
                  The other half of the reason is <strong>probability</strong>. A generative model
                  gives you an answer, but it will not honestly tell you how unsure it is. Jev hands
                  back a whole distribution every time — which is why this page can{" "}
                  <strong>paint its confidence straight onto the board</strong>: the darker the ink,
                  the more it wants to play there. Hesitation you can see is what this project really
                  sets out to show you.
                </>
              }
              zh={
                <>
                  另一半理由是<strong>概率</strong>。生成式模型给你一个答案，却不会诚实告诉你它有多犹豫。
                  Jev 每次都交回一整张分布表——所以这个网页才能把它的把握直接<strong>画在棋盘上</strong>：
                  墨色越浓，它越想下那里。看得见的犹豫，才是这个项目真正想给你看的东西。
                </>
              }
            />
          </p>
        </section>

        {/* ── WHO ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">
            <L en="Who" zh="Who · 谁在做" />
          </span>
          <h2>
            <L en="Who does what" zh="谁负责什么" />
          </h2>
          <p>
            <L
              en="Jev is provided by TypeSafe. In this game the work is divided like this — and where the line is drawn decides how strong the opponent is."
              zh={
                <>
                  Jev 由 TypeSafe 提供。在这盘棋里，工作是这样切的——
                  分界线画在哪里，就决定了对手有多强。
                </>
              }
            />
          </p>
          <div className="split">
            <div className="split-col">
              <div className="split-head">
                <L en="The program (the deterministic part)" zh="程序（确定性的部分）" />
              </div>
              <ul>
                <li>
                  <L en="The board, placing stones, deciding who has won" zh="棋盘、落子、胜负判定" />
                </li>
                <li>
                  <L en="Listing every empty point on the board as the options" zh="列出全盘所有空点当选项" />
                </li>
                <li>
                  <L
                    en="Finding every line taking shape on the board, with a sliding 5-cell window"
                    zh="用 5 格滑窗找出盘面上所有成形的线"
                  />
                </li>
                <li>
                  <L
                    en="Working out what each point would create, and what it would block"
                    zh="算出每个点会造成什么、挡掉什么"
                  />
                </li>
                <li>
                  <L en={<>The <span className="nw">禁手</span> (forbidden-move) rules and calling fouls</>} zh="禁手规则与犯规判定" />
                </li>
                <li>
                  <L en="Checking that the point Jev picked really is legal" zh="检查 Jev 选的点确实合法" />
                </li>
              </ul>
            </div>
            <div className="split-col" data-w="jev">
              <div className="split-head">
                <L en="Jev (the judgment part)" zh="Jev（判断的部分）" />
              </div>
              <ul>
                <li>
                  <L en="Where to play this move" zh="这一手下哪里" />
                </li>
                <li>
                  <L en="Who is ahead right now, and by how much" zh="现在谁占优，优多少" />
                </li>
                <li>
                  <L en="Whether the opponent’s threat has to be blocked" zh="对方的威胁是不是非挡不可" />
                </li>
              </ul>
            </div>
          </div>
          <p>
            <L
              en={
                <>
                  The program never narrows the options for Jev. It always gets{" "}
                  <strong>every empty point on the board</strong> — over two hundred choices on the
                  very first move. The program&rsquo;s job is to describe the position clearly, not
                  to hint at the answer.
                </>
              }
              zh={
                <>
                  程序从不替 Jev 缩小选项。它拿到的永远是<strong>全盘每一个空点</strong>——
                  开局第一手就是两百多个选择——程序只负责把盘面说清楚，不负责暗示答案。
                </>
              }
            />
          </p>
        </section>

        {/* ── HOW ──────────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag" data-k="how">
            <L en="How" zh="How · 怎么运作" />
          </span>
          <h2>
            <L en="How one white move comes about" zh="一手白棋，是这样生出来的" />
          </h2>
          <p>
            <L
              en="The instant you place a black stone, the five things below happen in order. The small animation under each one plays that step on a loop."
              zh={
                <>
                  你点下一颗黑子的那一瞬间，下面五件事依次发生。
                  每一格下面的小动画都在循环演示那一步。
                </>
              }
            />
          </p>

          {/* 1 */}
          <div className="how-step">
            <span className="how-n">
              <L en="1" zh="一" />
            </span>
            <div>
              <div className="how-title">
                <L en="Turn the board into a slip of paper" zh="把棋盘翻译成一张纸条" />
              </div>
              <p className="how-body">
                <L
                  en={
                    <>
                      The program writes the position out as <strong>a set of named fields</strong>{" "}
                      and hands it over: an ASCII drawing of the board, a list of coordinates for the
                      black stones and another for the white, the moves so far in order, and what
                      counts as a win in this game (if <span className="nw">禁手</span> is on, the limits on black are written
                      here too). The slip only <strong>states facts</strong>; it draws no
                      conclusions.
                    </>
                  }
                  zh={
                    <>
                      程序把盘面写成<strong>一组有名字的字段</strong>递过去：一张 ASCII 的棋盘图、
                      黑子与白子各自的坐标清单、到目前为止的手顺、还有这局怎么算赢
                      （开了禁手的话，黑棋受哪些限制也写在这里）。
                      这张纸条只<strong>陈述事实</strong>，不下任何结论。
                    </>
                  }
                />
              </p>
              <div className="how-anim">
                <div className="row2">
                  <Mini grid={POSITION} axes />
                  <span className="arrow">→</span>
                  <div className="slip">
                    <span>
                      <b>board_diagram</b>: <L en="whole board in ASCII" zh="ASCII 全图" />
                    </span>
                    <span>
                      <b>black_stones</b>: C2 C3 D4
                    </span>
                    <span>
                      <b>white_stones</b>: D3 E5
                    </span>
                    <span>
                      <b>move_history</b>: <L en="5 moves, in order" zh="5 手，依次" />
                    </span>
                    <span>
                      <b>win_condition</b>: <L en="five in a row" zh="五子连线" />
                    </span>
                  </div>
                </div>
                <p className="anim-cap">
                  <L
                    en={
                      <>
                        Columns are letters and rows are numbers, so the black stone at the top left
                        is called <code>C2</code>. A slip a person can read, and the model can take
                        in.
                      </>
                    }
                    zh={
                      <>
                        列是字母、行是数字，所以左边那颗黑子就叫 <code>C2</code>。
                        一张人看得懂、模型也读得进去的纸条。
                      </>
                    }
                  />
                </p>
              </div>
            </div>
          </div>

          {/* 2 */}
          <div className="how-step">
            <span className="how-n">
              <L en="2" zh="二" />
            </span>
            <div>
              <div className="how-title">
                <L
                  en="Work out the relationships too, and write them down"
                  zh="把“关系”也一并算好写上去"
                />
              </div>
              <p className="how-body">
                <L
                  en={
                    <>
                      Coordinates alone are not enough. The program also slides a{" "}
                      <strong>window five cells wide</strong> across the whole board in all four
                      directions: any window holding stones of only one colour, plus empty points, is
                      a live line. Why a window, and not “stones next to each other”? Because people
                      often leave gaps when they play: <code>XX.XX</code> makes five on the next
                      move, yet counting only touching stones reads it as two twos. Adding this took
                      the positions where a block is forced from <strong>all wrong to all
                      right</strong>.
                    </>
                  }
                  zh={
                    <>
                      只给坐标还不够。程序再拿一个<strong>五格宽的窗口</strong>在四个方向上滑过整张盘——
                      只要某个窗口里只有一种颜色加空点，那就是一条活着的线。
                      为什么是窗口而不是“连着的几颗”？因为人下棋常常跳着下：
                      <code>XX.XX</code> 下一手就成五，按“连着数”却只会读成两个二。
                      这一条加进去，逼着必挡的那些局面从<strong>全错变成全对</strong>。
                    </>
                  }
                />
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
                  <L
                    en={
                      <>
                        Where the window lingers longest, it frames exactly <code>XX.XX</code>: four
                        black stones and one empty point — five on the next move. The program also
                        writes down where its critical point is.
                      </>
                    }
                    zh={
                      <>
                        窗口停得最久的那一刻，框住的正是 <code>XX.XX</code>：四颗黑子加一个空点——
                        下一手就成五。程序同时写下它的要害点落在哪里。
                      </>
                    }
                  />
                </p>
              </div>
            </div>
          </div>

          {/* 3 */}
          <div className="how-step">
            <span className="how-n">
              <L en="3" zh="三" />
            </span>
            <div>
              <div className="how-title">
                <L en="Every question, asked at once" zh="所有问题，一次问完" />
              </div>
              <p className="how-body">
                <L
                  en={
                    <>
                      With the slip written, the program <strong>packs the questions into one
                      request</strong> and sends it off. The questions cannot see each other&rsquo;s
                      answers; they are answered <strong>at the same time</strong> — so anything that
                      can be asked together is never split across two requests. A second trip is
                      worth making only when an answer is needed to build a new state.
                    </>
                  }
                  zh={
                    <>
                      纸条写好，程序把问题<strong>打包成一个请求</strong>送出去。
                      这些问题彼此看不到对方的答案，它们是<strong>同时</strong>被回答的——
                      所以能一起问的就绝不分两次问。只有当一个答案必须拿来组出新的状态时，才值得再跑一趟。
                    </>
                  }
                />
              </p>
              <div className="how-anim">
                <div className="fan">
                  <span className="chip">
                    best_move{" "}
                    <em>
                      <L en="choice · every empty point" zh="choice · 全盘空点" />
                    </em>
                  </span>
                  <span className="chip">
                    position{" "}
                    <em>
                      <L en="score · five levels" zh="score · 五个等级" />
                    </em>
                  </span>
                  <span className="chip">
                    opponent_threat{" "}
                    <em>
                      <L en="boolean · block or not" zh="boolean · 要不要挡" />
                    </em>
                  </span>
                </div>
                <p className="anim-cap">
                  <L
                    en="Three questions, one round trip. Inference is cheap enough to ask freely."
                    zh="三个问题，一次往返。推理便宜到可以放手多问。"
                  />
                </p>
              </div>
            </div>
          </div>

          {/* 4 */}
          <div className="how-step">
            <span className="how-n">
              <L en="4" zh="四" />
            </span>
            <div>
              <div className="how-title">
                <L
                  en="What comes back is not a move but a whole table of probabilities"
                  zh="回来的不是一步棋，是一整张概率表"
                />
              </div>
              <p className="how-body">
                <L
                  en={
                    <>
                      Jev returns the point it chose, <strong>and a probability for every candidate
                      point</strong>. The table shows how torn it is: a first choice far above the
                      rest means it is sure; several points bunched together mean it finds the
                      position hard too.
                    </>
                  }
                  zh={
                    <>
                      Jev 交回它选的那个点，<strong>以及每一个候选点的概率</strong>。
                      这张表就是它的犹豫程度：第一名压倒性地高，代表它很确定；
                      几个点挤在一起，代表这局面它也觉得难。
                    </>
                  }
                />
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
                <p className="anim-cap">
                  <L
                    en="The same table feeds both the heat map on the board and the win-probability bar on the right."
                    zh="同一张表同时喂给棋盘的热区和右侧的胜率条。"
                  />
                </p>
              </div>
            </div>
          </div>

          {/* 5 */}
          <div className="how-step">
            <span className="how-n">
              <L en="5" zh="五" />
            </span>
            <div>
              <div className="how-title">
                <L
                  en="The program checks before the stone goes down; the probabilities surface as ink"
                  zh="程序先验过，才落子；概率则显影成墨色"
                />
              </div>
              <p className="how-body">
                <L
                  en={
                    <>
                      Types guarantee the shape of an answer, not that it is right. So the program
                      checks once more: does the coordinate parse? Is that point really empty?{" "}
                      <strong>If the move is not legal, it is not played.</strong> Only after the
                      check does the stone land, and the same probability table spreads across the
                      board as washes of ink, some dark, some light — the darker the wash, the more
                      Jev wants to play there.
                    </>
                  }
                  zh={
                    <>
                      类型保证了形状，不保证正确。所以程序会再确认一次：
                      这个坐标解析得出来吗？那格真的是空的吗？<strong>不合法就不下</strong>。
                      验过之后子才落下，同一张概率表化成深浅不同的墨晕铺在盘上——
                      浓的地方就是它更想下的地方。
                    </>
                  }
                />
              </p>
              <div className="how-anim">
                <div className="row2">
                  <span className="gate">
                    <L en="Legality check ✓" zh="合法性复核 ✓" />
                  </span>
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
                <p className="anim-cap">
                  <L
                    en="The ink wash surfaces first; then the white stone lands on the darkest point."
                    zh="墨晕先浮出来，白子随后落在最浓的那一点。"
                  />
                </p>
              </div>
            </div>
          </div>

        </section>

        {/* ── HOW MUCH ─────────────────────────────────── */}
        <section className="sec">
          <span className="sec-tag">
            <L en="How much" zh="How much · 多少代价" />
          </span>
          <h2>
            <L en="Fast and cheap, so ask freely" zh="又快又便宜，所以可以放手多问" />
          </h2>
          <div className="price">
            <div className="price-cell">
              <div className="price-k">
                <L en="Input" zh="输入" />
              </div>
              <div className="price-v">
                $0.042<small><L en="/ million tokens" zh="/ 百万 token" /></small>
              </div>
            </div>
            <div className="price-cell">
              <div className="price-k">
                <L en="Output" zh="输出" />
              </div>
              <div className="price-v">
                <L en="Free" zh="免费" />
              </div>
            </div>
            <div className="price-cell">
              <div className="price-k">
                <L en="Per move · cost" zh="一手棋 · 花费" />
              </div>
              <div className="price-v">
                <L en="Under a cent" zh="不到一分钱" />
              </div>
            </div>
            <div className="price-cell">
              <div className="price-k">
                <L en="Per move · time" zh="一手棋 · 耗时" />
              </div>
              <div className="price-v">
                0.45<small><L en="s · median" zh="秒 · 中位" /></small>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            <L
              en="The times were measured locally over 94 moves of real games: fastest 0.32 s, median 0.45 s, slowest 1.16 s. The opening move is the heaviest — over two hundred options judged together — and still takes only about 0.9 s. (Online, add a network round trip.)"
              zh={
                <>
                  耗时是本机 94 手真实对局量出来的：最快 0.32 秒，中位 0.45 秒，最慢 1.16 秒。
                  开局那一手最重——两百多个选项一起评——也就 0.9 秒上下。
                  （线上还要加一段网络往返。）
                </>
              }
            />
          </p>
          <p style={{ marginTop: 14 }}>
            <L
              en={
                <>
                  What this price changes is how you design: if thirty questions on one move are
                  still small change, there is no reason to ask fewer just to save.{" "}
                  <strong>The thing to think about is how to spread the questions out, not how to
                  economise.</strong>
                </>
              }
              zh={
                <>
                  这个价格改变的是设计方式：既然一手棋问三十个问题也只是零头，
                  就不该为了省而少问。<strong>该考虑的是怎么把问题摊开，而不是怎么节省。</strong>
                </>
              }
            />
          </p>
        </section>

        <div className="back-cta">
          <Link className="btn" href="/">
            <L en="Back to the game — try it yourself" zh="回到棋局，亲自试试" />
          </Link>
          <span className="note">
            <L
              en="When the next stone goes down, watch for the layer of ink that surfaces on the board first."
              zh="下一手落子时，注意盘上先浮出来的那层墨。"
            />
          </span>
        </div>
      </div>
    </main>
  );
}
