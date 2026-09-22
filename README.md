# 五子棋 · 裸 Jev 基线

人 vs [Jev](https://vercel.com/ai-gateway/models/jev)（TypeSafe 的 System One 判断模型），
部署在 Vercel。

人执黑先手，Jev 执白。界面提供「對等」和「讓一子」两档——`placeHandicap` 的落点是共线的，
让三子等于直接送出活三，所以两子以上只用于 `scripts/ladder.ts` 的强度测量，不作为可玩档位。

Jev 在**全部空点**中直接选出落子——代码不筛候选，只把盘面上
已有的棋形关系（含跳四、跳三）结构化地放进 state。`informed` 不再是开关，默认且唯一。

界面为**文人棋局**：宣纸、松烟墨、榧木、朱砂印。落子有墨晕扩散，Jev 的概率分布以
墨色深浅显影在棋盘上。响应式，手机可玩。

## 线上

https://hanxl.com/wuziqi

已开启 Vercel Deployment Protection（未授权访问返回 302），只有你的 Vercel 账号能打开。
要分享给别人，去 Settings → Deployment Protection 调整。

## 快速开始

```bash
npm install
npm test                      # 纯规则测试，不需要 key
cp .env.example .env.local    # 填入 AI_GATEWAY_API_KEY
npm run probe                 # 基线测量（会花几分钱）
npm run dev                   # 打开 http://localhost:3000/wuziqi 手动对弈
```

Key 只在服务端使用。`.env.example` 里**二选一**，别两个都填：

| | 变量 | 说明 |
| --- | --- | --- |
| **A（推荐）** | `JEV_TRANSPORT=native` + `TYPESAFE_API_KEY` | 走 TypeSafe 原生 API，不经过 Vercel 计费 |
| B | `JEV_TRANSPORT=gateway` + `AI_GATEWAY_API_KEY` | 走 Vercel AI Gateway，**账号必须绑卡**才放免费额度 |

`JEV_TRANSPORT` 不填时的默认逻辑是「有 gateway key 就走 gateway」，所以两个 key 都在、
又没显式指定的话会走 B —— 这种情况 probe 启动时会告警。

## 禁手

界面可勾选 **三三 / 四四 / 長連**，默认全关（无禁手）。勾选后：

- 棋盘上标出**朱砂叉**＝禁手点，鼠标悬停显示是哪一种
- 踩中立即判负，并指出踩的是哪条规则
- 每条规则下方展开**示意图**说明（朱砂子＝正在落的那一手）

禁手只约束黑棋（玩家）。白棋不受限，六子照样算赢。规则也会写进 Jev 的 state。

判定逻辑在 `lib/renju.ts`，`npm test` 里有 21 条断言覆盖 五連優先、四三合法、眠三不算等易错点。

## Jev 会利用你的禁手

开启禁手后，代码把「黑棋哪些线做不成」「白棋哪一手黑棋挡不了」作为**事实**写进 state，
但不点名最佳手——下不下由 Jev 判断。

```bash
npm run trap        # 测量它到底会不会用（需要 key）
```

实测 6 个严格局面 × 3 次：**有事实 16/18，无事实 0/18**。

注意：禁手只约束**黑棋**，白棋照样能下那些格子，而且那往往正是白棋自己的胜点。
（曾试过把禁手位从 Jev 选项里移除，实测不可行，已放弃，见 RESULTS.md 第 10 节。）

## probe 会告诉你三件事

```bash
npm run probe limits     # choice 问题最多能带多少个选项？225 行不行？
npm run probe tactics    # 4 个有标准答案的必着局面：必胜、必挡、挡活三、赢优先于挡
npm run probe selfplay   # Jev vs 随机落子，逐手打印概率分布与预判
```

每一手都会写进 `runs/probe-<时间戳>.jsonl`（完整概率分布、预判、局面分、延迟、token 用量），
之后和引擎基线做对比时直接读这个文件，不用重跑。

## 部署

```bash
npx vercel deploy --prod
```

生产环境变量（已设好）：`JEV_TRANSPORT=native`、`TYPESAFE_API_KEY`。
`.vercelignore` 排除了 `.env.local` / `runs/` / `scripts/` / `.vercel/`。

注意：Vercel 文件系统只读，所以 UI 对局日志（`runs/ui-*.jsonl`）**只在本地记录**，
线上自动跳过。要收集对局数据就在本地 `npm run dev` 玩。

## 结构

```
lib/board.ts        纯规则：坐标、成五判定、ASCII 渲染。只当裁判，绝不帮 Jev 挑点
lib/jev.ts          裸 Jev：全部空点作为 choice 选项，另加三个纯观测问题
app/api/move/       服务端路由（key 不出服务端）
app/page.tsx        棋盘 + 概率热力图 + 预判虚线圈
scripts/probe.ts    基线测量
scripts/test-rules.ts  25 条规则断言
```

设计背景、Jev 的 API 契约、以及下一步的引擎辅助方案，见 [AGENTS.md](./AGENTS.md)。
