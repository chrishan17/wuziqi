# 裸 Jev 基线 · 实测结果

2026-09-19 · transport `native`（TypeSafe API，`jev-latest`）· 15×15 · 无任何代码辅助

## 结论

**裸 Jev 能下五子棋。** 这是本次测量最意外的结果——原本预期它需要引擎生成候选集才能有像样的表现。

## 1. 选项上限：225 个选项可以

| 棋盘 | 选项数 | 结果 | 延迟 | input tokens |
| --- | --- | --- | --- | --- |
| 15×15 | 224 | **OK** | 857ms | 4406 |

单个 `choice` 问题带全部空点没有问题。原先担心的 225 选项上限**不存在**。

## 2. 必着局面：4/4

四个有唯一正确答案的局面，无任何提示：

| 局面 | 结果 | Jev 落子 | 正确答案 | 前二概率和 |
| --- | --- | --- | --- | --- |
| win-now（自己四连，直接成五） | PASS | H12 (60%) | H7 / H12 | 83% |
| block-or-lose（对方四连，必挡） | PASS | H12 (33%) | H7 / H12 | 53% |
| block-open-three（挡活三） | PASS | H7 (36%) | H7 / H11 | 65% |
| **win-beats-block（自己能赢，不该去挡）** | PASS | H12 (53%) | H7 / H12 | 70% |

最后一个最有信息量：黑白双方各有四连，正解是自己成五而非阻挡。Jev 选了赢，
去挡黑棋的 C7 只拿到 10%。这不是套模式能蒙对的。

**概率分布合理**：两个正确答案总是排在前二，其余候选骤降。

## 3. 对照实验：观测问题没有干扰

`bare` 模式只发 `best_move`，去掉 `position` / `opponent_threat` / `predicted_reply`：

| 局面 | 完整模式 | bare 模式 |
| --- | --- | --- |
| win-now | H12 (60%) | H12 (50%) |
| block-or-lose | H12 (33%) | H12 (31%) |
| block-open-three | H7 (36%) | H7 (37%) |
| win-beats-block | H12 (53%) | H12 (50%) |
| | **4/4** | **4/4** |

同一批问题共享一次前向传播，措辞理论上可能互相引导。实测没有——基线是干净的。

## 4. 自对弈：5 手取胜

Jev（黑，先手）vs 随机落子。H8 → H9 → H7 → H6 → H10，竖线成五。
对随机对手这是理论最少手数。

- 开局 H8（天元）**98%**，先验很强。
- `position` 单调上升 2.00 → 2.02 → 2.58 → 3.18 → 3.31（0-4 分，2 为均势）。
- `opponent_threat` 校准良好：真有立即威胁时 0.91 / 0.82，没有时 0.29 / 0.33 / 0.03。

## 5. 成本与延迟

| 指标 | 值 |
| --- | --- |
| 延迟 min/中位/max | 403 / 805 / 936 ms |
| 平均 input tokens | 4409 |
| **每手成本** | **$0.000185** |
| 每 100 手 | $0.0185 |

一整盘棋不到一分钱。扇出更多问题完全负担得起。

## 已修复：预判问错了局面

**问题**：`predicted_reply` 原先和 `best_move` 在同一请求里并行，所以 Jev 是在
自己还没落子的棋盘上猜对手。自对弈直接暴露了——ply 0 预测对手下 H8（它自己刚占的
天元），ply 4 预测 H7（同样是它自己要下的点）。不只是分数偏低，是问错了局面。

**修复**：落子并应用之后，单发第二次 `evaluate`，只问 `predicted_reply`，
选项是新棋盘的空点。预判失败不影响落子（catch 掉）。

**修复后重跑**，每一手的预判都不再是自己的落点，而且全是战术上正确的点——它自己
这条线的两个开放端：

| Jev 落子 | 预判对手 | 说明 |
| --- | --- | --- |
| H8 | G8 | 天元旁 |
| G8 | I8 | 线的**另一端** |
| I8 | J8 | 继续延伸端 |
| F8 | E8 | 外侧端 |
| J8 | — | 成五（F8–J8 横线） |

对随机对手命中 0/4，但随机对手本来就不可预测（理论命中率 0.46%），这个数字
不说明任何问题。**预判是否有效，必须对人类测。**

## 6. 难度阶梯：Jev 的上限在哪

加了一把**纯 TS 的尺子**（`lib/opponent.ts`，绝不调用 Jev）来量它。三档对手，
先验证尺子本身单调（各 20 盘，轮流执先）：L1 打 L0 **20–0**，L2 打 L1 **20–0**。

两个难度旋钮，都是**给 Jev 加难度**：对手强度 + 让子数。Jev 执白，每格 3 盘。

| 对手 | 让子 | Jev 战绩 | 平均手数 |
| --- | --- | --- | --- |
| L0 随机 | 0 | **3W 0L** | 10 |
| L0 随机 | 1 | **3W 0L** | 18 |
| L0 随机 | 2 | **3W 0L** | 11 |
| L0 随机 | 3 | **3W 0L** | 17 |
| L0 随机 | 4 | **3W 0L** | 15 |
| L1 贪心 | 0 | 1W **2L** | 44 |
| L2 威胁 | 0 | 0W **3L** | 11 |

**结论：Jev 的上限落在「随机」和「贪心」之间。**

让子对它几乎没有影响——让 4 子照样赢随机对手。但换成一个只会「能赢就赢、
对方要成五就堵」的贪心对手（L1），它就输 2/3。L2 平均 11 手就把它打死。

## 7. 失败模式：它不挡活三

抓了一盘 L2 的败局逐手还原（黑=对手，白=Jev）：

```
ply 0  黑 H8
ply 1  白 H9    threat=0.06
ply 2  黑 G9
ply 3  白 G8    threat=0.11
ply 4  黑 I7    → 黑成活三 G9-H8-I7，两端 J6 / F10 皆空
ply 5  白 G7    threat=0.27   ← 输棋就在这一手，没堵
ply 6  黑 F10   → 黑成活四 F10-G9-H8-I7，两端 J6 / E11
ply 7  白 H7    threat=0.50   ← 此时已必败，堵一端对方走另一端
ply 8  黑 J6    五连，结束
```

两个独立的问题：

1. **不挡活三。** ply 5 是唯一的败着。注意孤立局面下的 `block-open-three`
   测试它是**通过**的——盘面一干净就会挡，多几颗子就不挡了。
2. **威胁判断在有干扰时失准。** ply 7 黑棋已是活四，下一手必成五，正确答案接近
   1.0，Jev 给了 **0.50**。（ply 5 的 0.27 其实不算错——我那个 noul 问的是
   "下一手就能成五吗"，活三确实不满足。问题出在没有问活三。）
3. **只顾自己不看对手。** Jev 四手 H9/G8/G7/H7 全在自己那一小团里扩张，
   全程没有一手是针对黑棋那条对角线的。

第 4 节孤立战术题 4/4 和这里的落差，正是**"能做对单题"和"能下棋"的差距**。

## 8. 调用方式的锅，不是模型的锅

第 6/7 节的结论**说错了**。那测的是「我那套调用方式的上限」，不是 Jev 的上限。

从三盘败局里挖出 5 个**有强制正解**的位置（对方活三或活四，不堵必输），
每个位置 × 4 种调用方式 × 3 次。**选项集始终是全部空点，一个不筛。**

| 变体 | 改动 | 强制正解 | |
| --- | --- | --- | --- |
| V0 裸 | 当前基线 | **0/15** | 0% |
| V1 policy | instructions 里加五子棋优先级 | **0/15** | 0% |
| V2 lines | state 里加盘面线段关系 | **15/15** | 100% |
| V3 both | 两者都加 | **15/15** | 100% |

**加提示词零效果。加 state 直接满分。**

概率也从瞎猜变成笃定：V0 每次都在 15–31% 之间挑一个错的点；V2/V3 在 53–99%
之间锁定正解。V3 比 V2 概率更高（如 99% vs 92%）——优先级说明在模型**能看见**
盘面之后才起作用，看不见时说什么都没用。

### 原因

`black_stones: ["I7","H8","G9"]` 是一袋无序坐标。**没有任何地方说这三颗共线、
在对角线上、两端皆空。** 模型得从 ASCII 画里自己推二维关系，而它恰恰输在对角线上
——ASCII 里最难看出来的方向。

`lib/lines.ts` 做的只是把已经存在于盘面上的关系机械地列出来：

```json
{ "player": "black (X)", "stones": ["G9","H8","I7"],
  "direction": "diagonal up-right", "length": 3,
  "open_ends": ["F10","J6"],
  "note": "open three: becomes an open four next move unless blocked now" }
```

这是 **state，不是候选筛选**——选项仍然是全部 220 个空点，描述仍然全是 null。
文档要求 state 携带 "identities, **relationships**, policies, and current facts"，
我原先只给了 identities。

### 阶梯重跑

| 对手 | 让子 | 裸调用 | informed |
| --- | --- | --- | --- |
| L0 随机 | 0–4 | 3W 0L | 3W 0L |
| L1 贪心 | 0 | 1W **2L** | **3W 0L** |
| L1 贪心 | 1 | — | **3W 0L** |
| L1 贪心 | 2 | — | **3W 0L** |
| L1 贪心 | 3 | — | **3W 0L** |
| L1 贪心 | 4 | — | 1W **2L** ← 新断点 |
| L2 威胁 | 0 | 0W 3L（11 手） | 0W 3L（**45 手**） |

上限从「对等条件下输给贪心」推到「**让 3 子还能赢贪心**」。对 L2 仍然全败，
但从 11 手被打死变成撑 45 手。

**结论：之前看到的"笨"，绝大部分是我没把盘面讲清楚。** 剩下的差距（打不过 L2）
才是模型本身的边界，而那条边界在哪还没测到底。

## 9. 第二个 state bug：跳棋形全隐形

用户反馈「我还是随便赢」。查出来又是 state 的锅，而且比第一个更严重。

`lib/lines.ts` 第一版走的是**连续**棋子。于是：

| 棋形 | 实际含义 | 旧版告诉 Jev 的 |
| --- | --- | --- |
| `XX.XX` | **跳四**，下中间立刻成五 | 「两个 open two」 |
| `X.XXX` | **跳四** | 「一个 open three」 |
| `X.XX` | 跳三 | 「一个 open two」 |

**人类下棋天然带间隔**，所以人一用跳棋形，Jev 就完全看不见。

### 修复：滑动 5 格窗口

五连必然落在某个 5 格窗口内，所以「只含一方棋子 + 空点」的窗口就是活威胁。
`scripts/test-lines.ts` 12 条断言卡死了各种跳棋形和被封死的负例。

中途踩了个坑：窗口版第一次跑，命中率反而从 100% 掉到 **60%**。原因是
`critical_points` 把窗口内所有空点都算进去了——一个活三给出 4 个点而不是 2 个，
信号被稀释。收紧到「棋形跨度 ±1 格」之后恢复 100%，且概率更高（90–98%）。

### 测试集本身也有一个错

有个位置 Jev 被判 miss，查下来是**我的答案错了**：那里黑棋有两个三（一个横向
跳三、一个对角三），我的旧分析脚本只认出对角那个。Jev 去堵横向跳三是对的。
那实际是个**双威胁**局面，堵哪边都输——已从测试集剔除。

### 尺子也是瞎的

`lib/opponent.ts` 的 `scorePoint` 用的是同一套连续逻辑，所以 **L2 对手也看不见
跳棋形**。这意味着第 8 节「打不过 L2」是在一把坏尺子上量的，而人类远强于那个 L2
——这正好解释了为什么阶梯显示 Jev 还行、真人却能随便赢。

一并改成窗口版，重测单调性仍然成立（L1 打 L0 20–0，L2 打 L1 20–0）。

### 阶梯重跑（尺子更强，Jev 反而更强）

| 对手 | 让子 | 连续版 | **窗口版** |
| --- | --- | --- | --- |
| L1 贪心 | 0–3 | 3W 0L | **3W 0L** |
| L1 贪心 | 4 | 1W **2L** | **3W 0L** |
| L2 威胁 | 0 | **0W 3L** | **3W 0L** |
| L2 威胁 | 1 | — | **3W 0L** |
| L2 威胁 | 2 | — | **3W 0L** |
| L2 威胁 | 3 | — | **3W 0L** |
| L2 威胁 | 4 | — | 1W **2L** ← 新断点 |

对跳四 `XX.XX` 的单点验证：informed 下 H10 **99%**；裸调用也能选对，但只有 39%。

**两轮下来，所有「Jev 很笨」的表现，最后都归因到我的 state 编码。**
模型的实际边界目前仍未触到——现在需要比 L2 更强的尺子才能继续往上顶。

## 10. 讓 Jev 利用你的禁手（含兩次測量更正）

禁手開啟後，代碼把兩類**事實**放進 state，不寫結論、不點名最佳手：

1. `black_threats_that_cannot_be_completed` —— 黑棋某條線的所有延伸點都是禁手
2. `white_moves_black_cannot_answer` —— 白棋某手成四，而唯一擋點是黑棋禁手

```json
{ "white_plays": "G5", "completes_five_at": ["F5"],
  "black_may_block": false, "reason": "F5 is 長連禁手 for black" }
```

不是 `winning_move: G5`。**下不下由 Jev 判斷。**

### 兩次測量更正

**第一版**測出 3/3，差點寫進結論。複查發現四個局面裡三個黑棋有立即成五點
（H7/D3/M3），此時白棋正解是擋，Jev 選的「陷阱手」其實是**輸棋**。

**第二版**修掉上面的問題，測出 13/18，並且我寫下「對照組 18 次全在下廢棋」。
**這個解讀也是錯的**——用戶提出「把禁手位從選項裡移除不就行了」，順著這條線
去查，才發現那些「廢棋」點（F5 等）其實是**白棋自己的活四點**：

```
 5 . . O O O . . .        白 C5 D5 E5，黑 F1-F4/F6
       C D E F G          F5 既是黑棋長連禁手，也是白棋活四點
```

白棋下 F5 → C,D,E,F 兩端全空 = **活四，直接贏**。Jev 選它完全正確，是我的局面
沒有隔離出禁手這個變量。

### 第三版：嚴格局面

白棋的三必須**有一端被堵死**，這樣陷阱手只能做出「簡單四」（唯一成五點），
而那個點恰好是黑棋禁手。驗證條件：雙方都沒有立即成五點；陷阱手不是活四；
**白棋沒有任何其他能做出活四的手**——否則贏法與禁手無關，測不出東西。

| | 走出黑棋無法應對的那一手 |
| --- | --- |
| **有禁手事實** | **16/18 · 89%**（複跑 15/18，n 小有波動） |
| 無（對照組） | **0/18 · 0%** |

對照組穩定地去下那個禁手點本身——在嚴格局面裡它不成活四、贏不了，而且佔的是
一個黑棋永遠不能用的格子。

### 「把禁手位從選項裡移除」行不行

測了（`pruned` 模式）。答案是：**不行，而且在關鍵局面裡連補救版本都是空操作。**

- 禁手只約束**黑棋**。白棋照樣能下，而且那個格子**常常正是白棋自己的勝點**——
  上面 F5 的例子就是。無條件移除會把白棋的制勝手刪掉。
- 三三／四四禁手是**動態的**：白棋堵掉其中一個三，那個點就恢復合法。長連才永久。
- 實作了安全版（只移除「對白棋毫無用處」的禁手位）後跑嚴格局面：
  **剪掉 0 個選項**。因為在陷阱真正成立的局面裡，禁手位總是同時能給白棋做出四。

所以這條路在該起作用的地方不起作用，在別處又有刪掉勝手的風險。**已放棄，代碼已移除**
——這段記錄留著是為了說明為什麼不做。

### 剩下的 11%

兩次失敗仍是去下禁手位。事實就在 state 裡，防守本能壓過它。沒有用加指令糾正
——本專案已證明三次，指令推不動 Jev，只有 state 推得動。

## 11. 兼顧進攻

用戶反饋：白棋只會防守，不會邊防邊攻。同時報了一個視覺 bug——棋盤線畫在棋子上面。

### 線壓棋子

`.pt::before/::after` 畫格線，`.stone` 是子元素。三者都是 `position:absolute`
且 `z-index:auto`，繪製順序按樹序：`::before` → 子元素 → `::after`。所以**豎線
（::after）蓋在棋子上**。加顯式層級解決：格線 0、星位 1、墨暈 2、落子動畫 3、棋子 4。

### state 缺的東西

`lines_on_board` 描述**已經存在**的棋形。一個「既能擋黑棋、又能延伸自己」的點，
和一個「只能擋」的點，在裡面看起來**完全一樣**。所以「邊防邊攻」這個概念在
Jev 眼裡根本不存在。

新增 `point_effects`（`lib/effects.ts`）——每個近處空點下去會造成什麼：

```json
{ "point": "F10", "for_white": "makes an open three",
  "blocks_black": "three G9-H8-I7 (diagonal up-right)" }
{ "point": "J6",  "blocks_black": "three G9-H8-I7 (diagonal up-right)" }
```

兩個欄位同時出現就是雙用途點。**沒有 `dual_purpose` 標記，也沒有「優先選這些」
的提示**——共現本身就是事實。

### 測量一：單一威脅下選哪個擋點

黑棋一個活三，一個擋點同時給白棋做出活三，另一個什麼都不做。

| | 選了同時進攻的那個擋點 |
| --- | --- |
| 有 `point_effects` | **18/18 · 100%** |
| 無（對照組） | **18/18 · 100%** |

**沒有差別。** 局面乾淨、只有一個威脅時，Jev 本來就會選更好的那個擋點。
這個測試沒有抓到用戶看到的問題。

### 測量二：整盤棋

改測整局：vs L2 威脅型對手，各 6 盤，統計白棋走到什麼形、多久結束。

| | 勝 | 平均手數 | 白棋最高棋形 |
| --- | --- | --- | --- |
| 有 `point_effects` | 6/6 | **19.7** | 五 |
| 無（對照組） | 6/6 | **27.0** | 五 |

兩邊都全勝，**但帶 `point_effects` 平均快約 27% 結束**（對照組有一盤拖到 51 手）。
也就是說它幫助的是**收官**，不是防守。

成本：input token 3378 → 3584（+6%），延遲無明顯變化。

### 誠實的限度

L2 不是好的人類代理。用戶的棋力明顯高於 L2，而我**無法在沒有人類對局的情況下
測出這個改動對真人是否有效**。兩項測量一項無差別、一項改善中等——這就是目前
能拿到的全部證據。

## 尚未测量

- 对**人类**的棋力（自动阶梯用的是代码对手，不是人）
- informed 之下真正的上限：需要比 L2 更强的尺子（带搜索的对手）才能继续量
- state 里还能补什么关系（双威胁、交叉点、禁着点）能再推高多少
- 双威胁 / 活三转四这类更复杂的战术
- 预判对**人类**的命中率，以及能否打赢「人会下引擎最优点」这个基线
- 与引擎安全集方案的对比


## Jev as black (2026-09-19)

`ladder.ts` hardcodes `JEV = 2`, so every strength number above is **Jev-as-white**. The 先/後手
toggle made the other seat reachable. `npm run colour [games] [handicap]` plays the L2 threat-aware
opponent from both seats and records, per Jev move: how peaked `best_move` is (top1 / normalised
entropy), whether the move touches a stone Jev already owns, how many disconnected groups its own
stones form, and the strongest shape the move creates. Those four are a proxy for 章法 — whether
the moves add up to something.

### Even, free-style (5 games/seat)

| seat | result | avg plies |
| --- | --- | --- |
| white (baseline) | 5-0 | 20.2 |
| **black** | **5-0** | **16.8** |

| phase | seat | n | top1 | entropy | connected | clusters | makes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| open 1-4 | white | 20 | 0.611 | 0.212 | 45% | 1.50 | 0.90 |
| open 1-4 | black | 20 | 0.647 | 0.188 | 45% | 1.00 | 1.30 |
| mid 5-9 | white | 24 | 0.702 | 0.168 | 67% | 1.42 | 2.42 |
| mid 5-9 | black | 21 | 0.580 | 0.218 | 81% | 1.00 | 3.19 |
| late 10+ | white | 9 | 0.792 | 0.105 | 89% | 1.11 | 3.89 |
| late 10+ | black | 6 | 0.695 | 0.182 | 83% | 1.00 | 3.17 |

**This run does not reproduce "黑棋沒有章法" — it says the opposite.** Black never scatters
(`clusters` 1.00 throughout), stays connected more often than white, builds stronger shapes, and
wins four plies faster. **The ruler is the problem**: L2 dies in 16.8 plies, about 8 Jev moves, so
Jev-as-black simply out-races it and is never blocked hard enough to have to re-plan. A metric that
never sees re-planning cannot measure 章法.

### Under resistance — opponent handicap 2, games run longer (3 games/seat)

| phase | seat | n | top1 | entropy | connected | clusters | makes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| open 1-4 | white | 12 | 0.813 | 0.112 | 25% | 1.75 | 0.50 |
| open 1-4 | black | 12 | 0.775 | 0.139 | 25% | 1.33 | 0.67 |
| mid 5-9 | white | 15 | 0.763 | 0.136 | 60% | 1.93 | 2.27 |
| mid 5-9 | black | 15 | 0.680 | 0.182 | 60% | 1.33 | 1.73 |
| late 10+ | white | 6 | 0.780 | 0.138 | **100%** | 2.00 | **4.00** |
| late 10+ | black | 13 | 0.747 | 0.139 | **69%** | 1.15 | **2.85** |

Both still 3-0, but black now needs **24.7 plies to white's 20.0**, and in the late phase its moves
are less connected (69% vs 100%) and build weaker shapes (2.85 vs 4.00). Black's entropy is higher
than white's at every phase in both runs. **That is the first measurement consistent with the
report** — under resistance, black converts more slowly and coheres less late.

Do not over-read it: n is 13 vs 6 late moves, and the two seats are not facing the same positions.

### The opening is genuinely barer for black

`lines_on_board` needs two same-colour stones inside one 5-cell window; `point_effects` needs a
point that makes or blocks a *three*. Neither exists in the first few plies, and black leads:

| position | `lines_on_board` | `point_effects` |
| --- | --- | --- |
| Jev black, its 2nd move (1 own stone) | 0 | 0 |
| Jev white, its 2nd move (2 opponent stones) | 1 | 0 |

On its second move as black Jev is looking at a **bare coordinate list** — the exact state that
scored 0/12 on forced moves. As white it gets structure one ply earlier, free, from the opponent's
stones. Lowering either threshold to fill the gap risks the dilution documented above
(`critical_points` precision: 100% → 60%), so it must be measured, not assumed.

### What would actually settle it

L2 is the strongest ruler that exists here, and it is too weak. The decisive evidence is a real
game against a human. `logMove()` in `app/api/move/route.ts` no-ops when `process.env.VERCEL` is
set, so **production games are never logged** — reproducing this needs a game played against
`npm run dev`, which writes `runs/ui-<date>.jsonl`.


## 執黑應該主攻 — the priority ladder was written for white (2026-09-19)

Reported from play: "黑棋應該是進攻方，感覺他還在防守優先". The cause is in the instructions, not
the state. `PRIORITY` in `lib/jev.ts` reads:

    1. make five  2. block their five  3. block their open four
    4. block their open three  5. extend your own longest line
    "Defending … takes priority over building your own shorter line."

Items 2-4 are all blocks, the player's own offence is **last**, and the closing line settles ties
for defence. That was tuned when Jev only ever played white — the reacting seat. Black gets the
same ladder and plays it as written.

`PRIORITY_INITIATIVE` keeps every forced item (win now, block five, block an open four) and
interleaves the player's own threats above the merely urgent ones, because a four or an open three
forces the opponent to answer. A/B with `npm run colour [games] [handicap]`; the two black arms run
on identical seeds.

### Even, free-style, 8 games per arm — the setting the UI actually offers

| arm | result | avg plies |
| --- | --- | --- |
| white (`PRIORITY`) | 7-1 | 20.1 |
| black (`PRIORITY`) | 8-0 | 20.8 |
| **black (`PRIORITY_INITIATIVE`)** | **8-0** | **18.3** |

| phase | arm | top1 | entropy | connected | clusters | makes |
| --- | --- | --- | --- | --- | --- | --- |
| open 1-4 | black | 0.602 | 0.206 | 50% | 1.03 | 1.44 |
| open 1-4 | **black+atk** | 0.618 | 0.212 | 47% | **1.00** | **2.03** |
| mid 5-9 | black | 0.553 | 0.263 | 61% | 1.21 | 2.29 |
| mid 5-9 | **black+atk** | **0.604** | 0.260 | **68%** | 1.48 | **2.67** |
| late 10+ | black | 0.695 | 0.175 | 81% | 1.43 | 3.81 |
| late 10+ | **black+atk** | **0.779** | **0.114** | **89%** | **1.00** | **4.11** |

No losses, 2.5 plies faster, and **stronger shapes at every phase** — `makes` in the opening goes
1.44 → 2.03, i.e. black starts building from move one instead of answering. Late-game top1 rises
and entropy falls: it is not just more aggressive, it is more *certain*.

### Opponent handicap 2, 4 games per arm

| arm | result | avg plies |
| --- | --- | --- |
| black (`PRIORITY`) | 4-0 | 21.0 |
| black (`PRIORITY_INITIATIVE`) | 3-1 | 14.8 |

**The one loss in 12 games across both runs.** Trading a 29% faster win for one loss in four at a
2-stone deficit is plausibly real and plausibly noise at this n — it is the thing to watch if the
attacking ladder ever looks reckless. Under handicap the initiative genuinely belongs to the
opponent, so an attacker's ladder is the wrong prior there; a handicap-aware switch is untested.

Shipped: `app/api/move/route.ts` picks the ladder by seat, `jev === 1 ? PRIORITY_INITIATIVE :
PRIORITY`. Reverting is one line.


## 「開盤總喜歡直著一條」 — confirmed, and two fixes that did not work (2026-09-20)

Reported from play. `npm run colour` gained a `1-line` metric: the largest share of Jev's own
stones lying on a single straight line (gaps allowed).

| phase | white | black |
| --- | --- | --- |
| opening 1-4 | 0.70 | **1.00** |
| middle 5-9 | 0.45 | **0.61** |
| late 10+ | 0.36 | 0.41 |

**Read the opening row carefully — the metric is inflated there.** With one or two stones on the
board collinearity is trivially 1.00, and that bucket contains those plies. The *comparison* still
holds, because both columns carry the same artifact and white reaches 0.70 anyway: by its 3rd and
4th stone white has broken the line and black essentially never has. The midgame row is the clean
one, and the gap is real: **0.61 vs 0.45**.

### Cause, in two places

1. **Instruction.** Both ladders end with "extend your own longest line that still has open ends".
   That is literally an instruction to build a straight line, and a straight line is answered by
   blocking one end.
2. **State.** `pointEffects` kept only `best` — the single highest-severity threat containing the
   point — and dropped which *direction* each came from. So a point lying on two of Jev's lines
   read identically to one extending a single line, and a point making two separate "two"s was
   dropped entirely for being under the three threshold. Demonstrated on a 4-stone position: `J10`
   builds on **three** axes at once and `point_effects` did not list it at all; `H6`/`H7` build on
   two and were described only as `"makes an open three"`.

That second one is the **third instance** of this project's recurring bug — the encoding hides a
relationship and the model gets blamed.

### Fix A — `builds_on` in the state. REJECTED.

Added every direction a point builds in, kept multi-direction points that were previously dropped,
and weighted extra axes as a tie-breaker (not a promotion — an early version ranked a triple-two
above a plain four, which is wrong). 8 games, even, same seeds:

| arm | result | opening 1-line | late clusters | late makes |
| --- | --- | --- | --- | --- |
| black+atk (shipped) | **8-0** | 1.00 | **1.31** | **4.00** |
| black+axes | 6-2 | 1.00 | 1.88 | 3.47 |

**No effect on the opening at all, and two losses.** The reason it cannot work is structural: in
the opening `point_effects` is *empty* (measured earlier: 1 own stone → 0 entries), so no state
change reaches the plies being complained about. Later it only diluted — 15 listed points became
24, and late play got more scattered and built weaker shapes. Exactly the dilution already
documented for `critical_points`.

### Fix B — rewrite the instruction. REJECTED.

`PRIORITY_SHAPE` replaces item 7 with "play a point that works on two of your lines at once …
build width, not length". 8 games, even, same seeds:

| arm | result | opening 1-line | late top1 | late makes |
| --- | --- | --- | --- | --- |
| black+atk (shipped) | **8-0** | 1.00 | **0.810** | **4.18** |
| black+shape | 7-1 | 0.96 | 0.656 | 3.33 |

Moved the opening by 0.04, cost a game, and made the late game markedly less certain and weaker.

### Status

**Neither is shipped.** `multiAxis` defaults to `false` and `route.ts` does not pass it;
`PRIORITY_SHAPE` is not referenced outside the harness. Both are kept in the tree as documented
negative results so they are not re-tried blind.

The honest position: the straight-line habit is real and measurable, both obvious levers were
tried and both made Jev *worse* against the only ruler available, and L2 may simply not punish a
straight line the way a human does — in which case the metric to optimise is not one L2 can score.

## L3 — a ruler that is not already saturated (2026-09-21)

Every candidate improvement to the black request was being measured against L2, where black is
already **8-0 at even**. A saturated baseline can only detect harm, and that is exactly how the two
previous candidates were rejected (`builds_on` 6-2, `PRIORITY_SHAPE` 7-1). So the first piece of
work on "raise black's win rate" is not a state change — it is a stronger opponent.

`lib/opponent.ts` gains **L3**, still pure TypeScript, still never consulting Jev. Three additions
over L2's one ply of greed:

1. **VCF** — win by continuous fours, depth 8, node budget 400. Each step forces a unique reply, so
   the tree is narrow.
2. **双威胁** — `winsSoon` counts 四三 / 双三 through `countFours` / `countOpenThrees` from
   `lib/renju.ts`, whose recursive definitions were already tested there.
3. **一步否决** — a candidate is rejected if the opponent wins soon after it.

### Result — `npx tsx scripts/test-l3.ts 20`

| | vs L2 |
| --- | --- |
| L3 as black | 20-0 |
| L3 as white | 19-1 |

40 games in 6.8s, ~10ms per ply. For reference the seat advantage is real: L2-black beats L2-white
6/8, and L3-black beats L3-white 5/8. **L3 as white — the seat it will hold against Jev-as-black —
goes from L2's 2/8 to 19/20.**

### Two bugs found by playing it, both worth remembering

**A plain four is not a win.** The first `winsSoon` asked "after this move, does the player have a
five-completion point?" — which is true of every four, and a four is simply blocked. Every reply on
the board came back as winning, the defence saw no difference between them, and it played into the
board corner. The fix is `vcfAfter`, which judges a move as the FIRST forcing stone rather than
inspecting the resulting position: no completion → not forcing; one → the opponent blocks and the
search continues; two → an open four, and only then a win.

**A veto that cannot add a candidate is not a defence.** The first version filtered the mover's own
top 8 by static score. The saving move is frequently a point that scores near zero for the defender,
because `scorePoint`'s `denied` term is a MAX over the opponent's lines — blocking one of two threes
lowers that max by nothing. Measured: L3-as-white lost a game by never examining F7, which was
black's open four. Fixed by generating the opponent's key points explicitly (`winningReplies`) and
defending among *those*.

A follow-up to the same fix: the key-point generator first took the opponent's top 8 by static
score, and those scores **tie constantly** — every point completing any open three scores the same —
so the slice dropped the key point whenever more than eight tied. It now generates from geometry
instead: every point that makes a four (exact, from a single window scan), plus every point that is
a critical point of two threats in **different directions**, which is where a double threat has to
sit.

### Remaining — audited, not assumed

Both losses were replayed, counting `winningReplies(black)` before and after every white move:

```
game 19   ply 1-15   danger before 0-1, after 0     white answers everything
          ply 17     before 2  after 0
          ply 19     before 4  after 2              one stone can no longer remove them all
game  5   ply 17     before 5  after 2
```

So white is not missing a warning it was given: the danger count is driven to 0 every ply until
black plays a move that leaves **more winning replies than one stone can remove**. Catching that
needs to look one black move further ahead — the move that *creates* the double double is not
itself a four, a double threat, or a VCF start, so none of L3's three detectors fire on it.
Diminishing returns for a ruler; noted rather than fixed.

### Seat baseline, for reading future runs

L3 vs L3 at even: **black wins 5/8**. The first-move advantage is in the ruler too, so a future
Jev-as-white run against L3-black should be read against roughly 3/8, not against 50%.
`ladder.ts` hardcodes `JEV = 2`, so that is the seat it will report.

`scripts/colour-check.ts` runs the shipped black arm plus whichever candidate arms are enabled in
`ARMS` (currently `black+verify`; `black+shape` is commented out rather than deleted, because its
rejection was read off the saturated L2 baseline). Arms are seeded by colour, not by arm, so every
arm faces identical games — read the results paired.

`npm run colour` now defaults to L3 (`JEV_LEVEL=2` reproduces the old runs).

### First read: Jev-as-black vs L3 — the baseline is no longer saturated

`npx tsx --env-file-if-exists=.env.local scripts/colour-check.ts 3`, shipped arm
(`PRIORITY_INITIATIVE`), even, native transport:

| opponent | result | avg plies |
| --- | --- | --- |
| L2 (8 games, earlier run) | 8-0 | 18.3 |
| **L3 (3 games)** | **2-1** | **29.0** |

| phase | n | top1 | entropy | connected | clusters | makes | 1-line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opening 1-4 | 12 | 0.658 | 0.188 | 50% | 1.00 | 2.25 | 1.00 |
| middle 5-9 | 15 | 0.518 | 0.312 | 53% | 1.73 | 2.20 | 0.60 |
| late 10+ | 19 | 0.542 | 0.298 | 100% | 1.42 | 3.68 | 0.36 |

n is 3 games — this is a smoke test, not a strength claim. What it establishes is the thing the
ruler was built for: **there is now room above and below the current number.** The midgame is where
it looks worst (top1 0.518, entropy 0.312, connected 53%, clusters 1.73) — Jev gets blocked, has to
re-plan, and scatters, which the 17-ply races against L2 never tested.

Note also `1-line` falls 1.00 → 0.60 → 0.36 under real resistance, where against L2 it stayed at
0.61 in the midgame. The 開盤直線 complaint may read differently against a ruler that punishes it,
and `PRIORITY_SHAPE`'s rejection was read off the saturated baseline — it is commented out in
`ARMS`, ready to re-run rather than deleted.


## 第二轮验证 — built, measured, NOT shipped (2026-09-21)

The 大师 loop from AGENTS.md, implemented at last: `nakedJevMove({ verify: true })` takes round
one's top 3 and issues **one request per candidate** against the board as it would stand after that
move, asking two `noul` questions — `unanswerable` ("do I now have a threat they cannot fully
answer?") and `refuted` ("do they now have a forcing win?"). Policy in code:
`score = p1 + VERIFY_ALPHA * (unanswerable - refuted)`, gated off when round one is already ≥0.9
sure. See AGENTS.md for the mechanism and the reasons it is one request per candidate.

### A/B, Jev black vs L3, 12 games per arm, identical seeds

| arm | result | avg plies |
| --- | --- | --- |
| `black+atk` (shipped) | **8-4** | 32.5 |
| `black+verify` | 7-5 | 34.8 |

Seeded by colour, so both arms played the same twelve games. Paired:

```
atk:     W W W W L L L W L W W W
verify:  W L W W W L W L L L W W
```

Seven games agree. Of the five that differ, verify won 2 and lost 3. **That is the whole effect
size** — and it is a coin flip.

| phase | arm | connected | clusters | makes |
| --- | --- | --- | --- | --- |
| middle 5-9 | atk | 61% | 1.39 | 2.32 |
| middle 5-9 | verify | 67% | 1.40 | 2.45 |
| late 10+ | atk | 88% | 1.34 | 3.29 |
| late 10+ | verify | 90% | 1.52 | 3.18 |

`top1` and `entropy` are deliberately **left out of that comparison**: both are read off round one's
distribution, which round two never touches, so any difference between the arms is a different
trajectory rather than an effect of the feature. Only the columns that depend on the move actually
played can say anything.

The second pass ran on 192/218 moves (88%) and switched Jev off round one **17** times. The honest
reading is **no measured gain**, so `app/api/move/route.ts` is unchanged and the UI does not use it.

### Why — the calibration, which the scoreboard cannot show

A feature that only acts on 9% of moves cannot be evaluated by a 12-game record.
`scripts/test-verify.ts` instead ground-truths every candidate the pass looked at against L3's own
tactics: is Jev still holding a winning point after white's best reply? does white hold one?

8 games, 216 candidate judgments (`npx tsx --env-file-if-exists=.env.local scripts/test-verify.ts 8`,
Jev 5-3 in that run):

| question | P(said) when TRUE | when FALSE | separation |
| --- | --- | --- | --- |
| `unanswerable` | 0.711 (n=54) | 0.471 (n=162) | **+0.240** |
| `refuted` | 0.386 (n=26) | 0.216 (n=190) | +0.170 |

An earlier 4-game read (n=132) gave +0.266 and +0.108 — `unanswerable` is stable, `refuted` moved a
lot between runs, which is itself the point about how thin its evidence is.

Switches across the 8 games: 10 — **1 better, 2 worse, 7 neutral**.

So the mechanism is sound and both questions carry some signal, but:

1. **`unanswerable` separates roughly 1.5x better than `refuted`, and they carry equal weight.**
   Half the policy term is the weaker half, with full authority over round one.
2. **The pass confirms rather than corrects.** 7 of 10 switches were neutral by the proxy and the
   remaining three were a wash (1 better, 2 worse). That is the same story the 8-4 / 7-5 scoreboard
   tells, arrived at independently and on 20x the sample.

### The pre-registered next step, so it is not tuning on the test set

Weight the two terms by their measured separation (`unanswerable` ~0.5, `refuted` ~0.35) and re-run.
**Fit on the seeds `test-verify.ts` already used (5000+), evaluate on the `colour-check` seeds
(9000+), and report both.** Alternatively `refuted` is a question code can answer deterministically
— `winningReplies` in `lib/opponent.ts` already does — but handing it to code moves the Layer 1/2
boundary and is the 入门/標準 difficulty dial, not a free win. That is a product decision, not a
tuning one.


## 篩選五個候選 — decision rule, written before the results were read (2026-09-21)

Five arms against L3, 12 games each, all on the same seeds (9000+), so every arm plays identical
games and the comparison is paired:

| arm | what it changes |
| --- | --- |
| `black+atk` | control — shipped ladder, nothing added |
| `black+verify2` | round two, terms weighted by measured separation (0.5 / 0.35) instead of equally |
| `black+dual` | `double_threat` in `point_effects` — 四三 / 双三 as one field |
| `black+open` | `stone_relations` — the opening's cross-colour geometry |
| `black+shape` | `PRIORITY_SHAPE`, re-run against a ruler that is not saturated |

### Why the rule is written down first

Control sits at 8-4, so per-arm SD is about 1.6 games. **The best of five arms will land 1.5-2 games
above the mean by chance alone**, and whatever wins a screen regresses on re-measurement. Picking
the winner and shipping it is how this project would manufacture a result instead of finding one.

So, fixed in advance:

1. **Screen statistic** is the paired discordant net over the 12 shared games — of the games where
   the arm and the control disagree, wins minus losses. A raw record is not enough; the seven games
   both arms win carry no information.
2. **A candidate must reach net ≥ +3** to go forward. Anything less is inside the noise.
3. **Confirmation on fresh seeds** (`SEED_BASE=12000`), 24 games, control included. 9000+ is now
   spent on the screen and 5000+ on fitting `verify2`'s weights; re-using either would be scoring
   the fit on its own training set.
4. **Ship only if** the confirmation net is ≥ +4, or the combined 36-game paired net is ≥ +6.
5. **If nothing clears, nothing ships**, and the deployment carries no behaviour change. Saying that
   is the result; quietly deploying an unmeasured arm is not.
6. A winner is wired for **`jev === 1` only**. Every number here is the black seat; applying it to
   white unmeasured is the exact pattern the rest of this file exists to prevent.


### Screen result — nothing cleared, and why (seeds 9000+, 12 games each)

| arm | record | discordant | won | lost | paired net |
| --- | --- | --- | --- | --- | --- |
| `black+atk` (control) | 7-5 | — | — | — | — |
| `black+verify2` | 6-6 | 5 | 2 | 3 | **-1** |
| `black+dual` | 7-5 | 4 | 2 | 2 | **0** |
| `black+open` | **9-3** | 4 | 3 | 1 | **+2** |
| `black+shape` | 6-6 | 1 | 0 | 1 | **-1** |

`black+open`'s 9-3 is exactly the winner's-curse case the rule was written for: it differs from the
control on only **four** games. The mechanism check settles it — `scripts/test-opening.ts` asks Jev
for its second move with and without the field across 8 openings and it **changed the move in 1 of
8**. A field that moves one opening in eight cannot produce a 9-3. Nothing goes to confirmation.

Reweighting `verify2` by measured separation did not rescue the second pass either: equal weights
gave 7-5, measured weights 6-6, control 8-4 and 7-5 on two different seed sets. It stays off.

### Why they all failed, and the measurement that found the real gap

Every one of those candidates is a **tiny intervention**: `dual` fires on ~1 point per game, `open`
on 1 opening in 8, `verify2` switches 12 moves in 153. None of them can move a 12-game record
because none of them changes much. So instead of screening more of them, ask what is actually
losing the games.

`scripts/test-forced.ts` works out, independently and before Jev is asked, what each position
demands, then checks what Jev played. 8 games, Jev 5-3:

| the position demanded | arose | missed | |
| --- | --- | --- | --- |
| `win_now` — Jev can make five | 5 | 0 | **0%** |
| `must_block` — opponent completes five next move | 12 | 2 | 17% |
| `must_answer` — opponent wins soon, and a defusing move exists | 31 | 20 | **65%** |

**Jev never misses a five. It misses the move that defuses the opponent's coming double threat two
times out of three, and that situation arises four times per game.** That is where black's losses
are, and it is not a subtlety of judgment.

It is also, once again, the encoding. `blocks_black` / `blocks_white` in `lib/effects.ts` are built
from the critical points of threats that ALREADY exist. A point from which the opponent would
CREATE a 四三 / 双三 carries no field at all — on the test board for `white_would_make`, the control
`point_effects` has **zero entries**, so the losing square is indistinguishable from any other empty
point. Fourth instance of this project's recurring bug.

### Primary test: `black+key` (seeds 12000+, 24 games)

`<colour>_would_make` states what the OPPONENT would make by playing a point, and only when that is
two or more threats of severity three-or-better. Narrow by construction, and aimed at the 65%.

This is a **new hypothesis from a diagnostic, not the screen's winner**, so the screen contributes
no evidence to it and the seeds are fresh. Pre-registered ship threshold, unchanged from above:
**paired net ≥ +4 over 24 games.**


### Primary test result — `black+key` is neutral, and the seed variance is the bigger news

```
atk:  W L L W L W W L W L L L L L L W L L L L L W L L   7-17
key:  W L L L L W W L W L L L L W L L L L L L W W L L   7-17
```

Discordant 4, won 2, lost 2, **net 0**. Threshold was +4. It does not clear.

**Control went 8-4 and 7-5 on seeds 9100+ and 7-17 on seeds 12100+.** The seed blocks are not
degenerate — white's first reply is 16 distinct points in one block and 15 in the other — so this is
just how wide the variance is. Jev-as-black against L3 is somewhere near **14-36 (39%)** across all
36 control games, not the 67% the first 12 suggested. Every 12-game number in this file, including
the screen above, has error bars that wide.

That also sets the budget for this kind of work: separating 39% from 55% at 80% power needs on the
order of 170 games per arm. **No 12- or 24-game A/B can resolve the effect sizes these state fields
produce**, which is the real reason the screen found nothing, and it is not fixed by running more
arms.

### What the field did do — measured on the mechanism instead

`scripts/test-forced.ts 8 key` reruns the audit with the field on, same seeds:

| the position demanded | off: arose / missed | on: arose / missed |
| --- | --- | --- |
| `win_now` | 5 / 0 — 0% | 5 / 0 — 0% |
| `must_block` | 12 / 2 — 17% | 25 / 1 — **4%** |
| `must_answer` | 31 / 20 — **65%** | 43 / 24 — **56%** |

Both rates improve and neither is a clean comparison: the games diverge, so the denominators are
different positions. Read it as "not harmful, possibly slightly better", which is all 8 games can
support — and it is consistent with the scoreboard's net 0.

### Where this leaves black's win rate

The state-side route is exhausted at the effect sizes that are measurable here. Five candidates,
one diagnostic and roughly 150 games say the same thing: **Jev sees the position and still fails to
answer the opponent's coming double threat in over half of the positions where that is the move.**
Adding the fact to the state did not convert it into the move.

The lever that certainly works is the Layer 0/1 boundary — code enforcing the forced moves it can
already detect. It is not a tuning question: it is the difficulty dial this project is built around,
and spending it is a product decision.


## SHIPPED — `double_threat`, +8.2pp for black, 680 games (2026-09-21)

The state field that survived. `point_effects` collapses each point to its single strongest shape,
so a move making a four AND an open three reads exactly like a plain four. `double_threat` states
both, and only when there are two or more of severity three-or-better.

`scripts/ab.ts` — games in a worker pool, every game appended to `runs/ab-*.jsonl`, API failures
counted as `error` and dropped from both arms rather than scored as losses.

| run | control | dual | paired | McNemar |
| --- | --- | --- | --- | --- |
| seeds 30000+, 170 games | 62-108 (36.5%) | 81-89 (47.6%) | won 40 lost 21, **net +19** | p = 0.021 |
| seeds 40000+, 170 games | 85-85 (50.0%) | 94-76 (55.3%) | won 34 lost 25, **net +9** | p = 0.298 |
| **pooled, 680 games** | **147-193 (43.2%)** | **175-165 (51.5%)** | **won 74 lost 46, net +28** | **p = 0.014** |

**Read this honestly.** The replication reproduced the DIRECTION but not the size: +11.1pp became
+5.3pp and, on its own, was not significant. That is textbook regression after selecting a winner
from three arms. The believable estimate is the pooled **+8.2pp**, and the true effect is more
likely near the replication's +5 than the discovery run's +11.

Note also that the control scored 36.5% on one seed block and 50.0% on the next. **Only the paired
column means anything here**; any absolute win rate in this file that came from fewer than ~100
games should be read as decoration.

### The two candidates that did not make it

- `key` (`<colour>_would_make` — the points the OPPONENT turns into a double threat) went +8 paired
  over 170 games, p = 0.37. Noise. This one is worth flagging because the argument for it was the
  strongest in the whole session: it came from a measured failure (65% of `must_answer` positions
  missed), it was aimed precisely at that failure, and the state demonstrably could not express the
  fact before. **It still did not work.** A good mechanism story is not evidence.
- `open`, `verify2`, `shape`: screened at net +2, -1, -1 over 12 games and never re-tested.

### What the 12-game screen got wrong

`dual` screened at **net 0** and was nearly dropped; `open` screened at 9-3 and led the table on
pure luck (it changes Jev's move in 1 opening out of 8). A 12-game screen against a ~43% baseline
does not rank candidates — it shuffles them. Every 12-game A/B in this file predates that lesson.

### Still open

- Measured for **black only**. Enabled for both seats on request (2026-09-22): white is unmeasured.
  The field is computed for the seat Jev holds, so as white it describes white's own shapes.
- The `must_answer` miss rate (56-65%) is still the largest known gap and nothing has moved it.
  The Layer 0 backstop remains the one lever known to work on it, and remains unspent.


## Cost of this campaign — it took production down

~1,050 games, ~16.7k requests, ~57M input tokens, about **$2.39** at the quoted rate. That
exhausted the organisation's TypeSafe credits, and since the scripts, `npm run dev` and the
deployed app all read the same `TYPESAFE_API_KEY`, **production now returns
`TypeSafe API 402: billing_error` on every move**. The deploy itself is fine — the page serves, the
route is correct, no key is in the client bundle — it simply has no credits to spend.

Budget the next one: ~3.4k input tokens per move, ~16 Jev moves per game, so **a 170-game arm is
~9.3M tokens** and a three-arm run is ~28M. Check the balance first at
https://console.typesafe.ai/settings/billing.


## 执黑开盘经验 — told to Jev, 10 games vs L3, not shipped (2026-09-22)

详注执黑的前四手几乎总在一条直线上。开盘时 `lines_on_board` 和 `point_effects` 是空的，真正起作用的是优先级第 7 条「延长自己最长的线」。`PRIORITY_SHAPE` 把这条改成「走宽度」并且整局都用，后盘变差，所以没有再整局替换。这次只在黑棋已有子数少于 4 时换上 `PRIORITY_OPENING`：第一子天元，第二子不要落在自己和最近白子的连线上，已有的子若在一条线上就换方向，开局不要去挡还不是四或活三的白子。第 1–6 条（成五、挡五、做四、挡四、做活三、挡活三）不动。详注对照是 `PRIORITY_INITIATIVE` + `doubleThreat`，和页面一致。

`npx tsx --env-file-if-exists=.env.local scripts/test-opening-l3.ts`。L3，偶数，自由规则，种子 12000–12004，每种子两臂，共 10 盘。

| seed | 详注 | 手数 | 前四手 | 1-line | 执黑 | 手数 | 前四手 | 1-line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12000 | W | 25 | H8 H9 H6 H7 | 1.00 | W | 27 | H8 H9 I10 H6 | 0.75 |
| 12001 | W | 23 | H8 I8 K8 J8 | 1.00 | W | 23 | H8 I8 K8 J8 | 1.00 |
| 12002 | W | 23 | H8 I8 K8 J8 | 1.00 | W | 23 | H8 I8 K8 J8 | 1.00 |
| 12003 | L | 30 | H8 H9 H6 H7 | 1.00 | L | 30 | H8 H9 H6 H7 | 1.00 |
| 12004 | W | 19 | H8 I8 K8 J8 | 1.00 | W | 23 | H8 H7 H10 H9 | 1.00 |

两臂都是 4-1。配对：执黑更好 0，详注更好 0，同胜负 5。前四手有变化的是 2/5，第四子离开那条线的是 1/5。

原因在梯子的顺序，不在措辞没写到。两子相邻之后，沿这条线延长常常已经是活三，而「做活三」是第 5 条，排在开盘经验前面。所以经验只在还做不出活三时才被看见；一旦能沿唯一的线做成活三，线就被补回去了。12001 和 12002 两臂棋谱相同，就是这个。

没有接到页面上。10 盘里胜率没有动。把斜向分叉排到做活三前面的结果见下一节。


## 斜向分叉排到做活三前面 — 10 games vs L3, not shipped (2026-09-22)

棋谱里的说法是斜活二比直活二更难被一子防住。上一节的开盘文字排在「做活三」后面，沿直线延长往往已经是活三，所以没生效。这次两处一起改，仍然只在黑棋不足四子时：

- 状态里加 `opening`：列出离开直线的斜向邻点，和只把直线加长的点。已经走成斜线的，这个字段不再出现。
- `PRIORITY_DIAGONAL` 把「走 `diagonal_off_that_line` 里的点」放在做活三前面。成五、挡五、做四、挡活四仍在更前面。四子之后回到 `PRIORITY_INITIATIVE`。

`npx tsx --env-file-if-exists=.env.local scripts/test-diagonal.ts`。L3，种子 13000–13004，每种子两遍，共 10 盘。详注仍是页面上的优先级加 `double_threat`。

| seed | 详注 | 手数 | 前四手 | 1-line | 斜向 | 手数 | 前四手 | 1-line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13000 | W | 21 | H8 I8 F8 G8 | 1.00 | L | 14 | H8 G7 I8 H6 | 0.50 |
| 13001 | W | 35 | H8 H7 H10 H9 | 1.00 | L | 22 | H8 G7 J10 I9 | 1.00 |
| 13002 | W | 21 | H8 G8 J8 I8 | 1.00 | W | 17 | H8 G7 J10 I9 | 1.00 |
| 13003 | W | 23 | H8 I8 K8 J8 | 1.00 | L | 14 | H8 G7 F6 I9 | 1.00 |
| 13004 | W | 23 | H8 I8 K8 J8 | 1.00 | L | 24 | H8 G7 H7 E10 | 0.50 |

详注 5 胜。斜向 1 胜 4 负。配对：斜向更好 0，详注更好 4，同胜负 1。五盘开局都变了，第二子都是 G7，也就是天元的斜邻。其中三盘接着把这条斜线走成一条（H8 G7 J10 I9、H8 G7 F6 I9），因为两子一旦在斜线上，`opening` 就不再列出分叉，做活三又把斜线补长。第四子离开单线的只有 2 盘，这两盘都输了。

没有接到页面上。斜着起手换掉了直线，对 L3 的胜负变差。

## 整局偏向斜线 — 10 games vs L3, not shipped (2026-09-22)

上一节只盖住前四手，而且两子一旦在斜线上，分叉字段就消失，做活三把那条斜线补长。这次三处都按整局来改，成五、挡五、做四、挡活四不动：

- `point_effects` 里每个形状写上方向。同级时斜向排在横竖前面。
- `diagonal_branches` 只列「从横线或竖线向外的斜邻」，也就是 `point_effects` 因为不到三而丢掉的那些点。肩上的正交邻点不列。已经有两子同在一条斜线上、或者已经能做四，这个字段就不出现。
- `PRIORITY_LEAN` 整局都用：字段还在时，走斜向分叉，即使直线延长已经是活三；字段消失之后，有斜向活三就走斜向活三，否则延长斜线。

`npx tsx --env-file-if-exists=.env.local scripts/test-lean.ts`。L3，种子 14000–14004，每种子两遍，共 10 盘。详注仍是页面上的优先级加 `double_threat`。

| seed | 详注 | 手数 | 前四手 | 斜向 | 手数 | 前四手 |
| --- | --- | --- | --- | --- | --- | --- |
| 14000 | W | 23 | H8 H7 H10 H9 | L | 32 | H8 H7 G9 G5 |
| 14001 | L | 48 | H8 H9 I8 J8 | L | 54 | H8 I9 F6 G7 |
| 14002 | W | 27 | H8 G8 J8 I8 | W | 35 | H8 G8 I7 I5 |
| 14003 | L | 14 | H8 G8 J8 I8 | L | 22 | H8 G8 I7 H10 |
| 14004 | L | 30 | H8 H9 H6 H7 | L | 10 | H8 H9 G7 I9 |

详注 2 胜 3 负。斜向 1 胜 4 负。配对：斜向更好 0，详注更好 1，同胜负 4。第二子多半还在直线上，因为只有一子时分叉列表是空的。第三子走出去（G9、I7、G7），第四子又去补斜线。14004 走到 H8 H9 G7 I9，10 手输了。

没有接到页面上。整局改完，唯一变了胜负的那一盘是斜向输的。这一版把斜向分叉排在活三前面，所以被拿掉了。

详注随后改成活三仍在斜向分叉前面（`PRIORITY_LEAN` / `PRIORITY_LEAN_WHITE`，`leanDiagonal`）。有好几处活三时走斜向的那一处；做不出活三时才走 `diagonal_branches`。方向写在 `point_effects` 的句子里。这是要求改的，不是上面这 10 盘测出来的。



## 两处编码错误和一把坏尺子 — 离线审计真人对局 (2026-09-23)

不调用 Jev。把 `runs/ui-*.jsonl` 里约 33 盘、236 手的真人对局逐手重建，用代码判断局面要求什么。

### 尺子：`test-forced.ts` 把反杀算成漏着

`must_answer` 只认"下在解围点上"。Jev 自己走出活四、四三或 VCF 起手也是正解，却被记成漏着。真人对局里：

| | 漏着 |
| --- | --- |
| 旧口径 | 12/25 (48%) |
| **修正后** | **5/25 (20%)**，另有 7 手是 Jev 自己的必胜反击（5 手活四） |

上面对 L3 测出的 65% / 56% 用的是同一个旧口径，**应视为高估**。A/B 日志只存胜负、没存棋步，无法离线重算。
`scripts/test-forced.ts` 已改：反杀单独计为 `countered`，不再算作漏着。

### `double_threat` 把眠三算成威胁

判断条件是"三或以上"，没区分活三和眠三，于是两个眠三也被标成四三/双三，并在排序里加 45 分、排到真正的冲四前面。
真人日志里 131 个标签有 70 个是这种。ply 24 那手 G9（55%，正解 K13）就是被这个假标签带走的。
修正后只数冲四和活三：61 个标签，除两处"成五+活三"外全部与 `lib/renju.ts` 的 `countFours + countOpenThrees >= 2` 一致，没有漏标。
`<colour>_would_make` 同样的问题，一并修正。**+8.2pp 是在旧定义上测的，新定义未测。**

### `game` 字段自相矛盾

`buildState` 的 `game` 固定写 "free-style rules, no forbidden moves"，开了禁手也不变，和 `win_condition` 矛盾。已改为随规则变化。

### 20 盘对照：修正版没有更好 (2026-09-23)

Jev 执黑 vs L3，页面上的配置（`PRIORITY_LEAN` + `leanDiagonal` + `double_threat`），种子 50000–50019，两臂同种子。
旧定义用 `JEV_LEGACY_DOUBLE_THREAT=1` 复现。`ARMS=ship scripts/ab.ts 20 5`。

```
修正版  WWWLWWLLLLLWLWLLLLWW   9-11
旧定义  WWWLWWLLLLWWLWLWWWWW  13-7
```

不一致 4 盘，全是旧定义赢。精确 McNemar p = 0.125，不显著；20 盘本来就分辨不了这种幅度。
但方向和预期相反：假标签（两个眠三）可能在起作用——它把"同时在两条线上成三"的点排到前面，
相当于一个更窄的 `builds_on`。**修正版不上线，等 170 盘。** 这是事实准确性和胜率第一次方向冲突。

### 复查、再修、再跑 20 盘 (2026-09-23)

复查 state 又发现两处和棋盘不符，一并修掉（三个臂都带着）：
- `blocks_black` / `blocks_white` 不说被挡的三是活是眠。挡一个眠三和挡一个非挡不可的活三读起来一样。现在写 `open three …` / `blocked three …`，排序也是 四 > 活三 > 眠三。
- `stones_on_board` 用的是 `history.length`，让子的子不在 history 里。改为数棋盘。

`double_threat` 拆成三种模式（`DoubleThreatMode`）：`legacy` 旧定义；`fixed` 只数冲四和活三；`split` 在 `fixed` 之外，把"两条线上各成三但逼不出两手"的点标成 `shapes_on_two_lines`，排序和 `legacy` 完全一样——和 `legacy` 只差名字。
`scripts/ab.ts` 现在把每盘的棋步和 Jev 每手的概率记进日志。

种子 51000–51019，三臂同进程配对，基准 `legacy`：

| 臂 | 战绩 | 平均手数 | 配对 vs legacy |
| --- | --- | --- | --- |
| legacy | 11-9 | 32.9 | — |
| fixed | 11-9 | 30.8 | 赢 4 输 4，净 0 |
| **split** | **15-5** | **28.8** | 赢 4 输 0，净 +4（精确 p = 0.125） |

**用棋步复盘不一致的盘，分叉点有一大半和这个字段无关。** 51006 在第 2 手、51014 在第 4 手、51011 在第 8 手就分开了，分叉那一手两边都没有 `point_effects` 条目——
那时唯一的差别是 `point_effects_note` 的措辞。也就是说，**state 里任何一句话变了，都会把势均力敌的点重新洗牌**，20 盘里的胜负差有相当部分是这种蝴蝶效应，不是机制。

真正在分叉点上用到了这个字段的盘：
- fixed 赢的 3 盘（51001、51007、51013）都是 fixed 下出了**真双三**，而 legacy 在同一局面选了"活三+眠三"的假标签点——假标签和真双威胁排序相同，把真的淹没了。
- legacy 赢的 2 盘（51002、51017）是 legacy 下了"活三+眠三"点，fixed 去下别处。
- split 的 4 盘净胜里只有 51013 用到了字段（真双三）。

两轮合计（40 个种子）：fixed vs legacy 赢 4 输 8（两轮配置不同：第一轮没有 `blocks_*` 修正，note 也一样，只切了定义）；split vs legacy 只有这一轮，净 +4。**都不显著。** 能说的是：
假标签确实会遮住真双威胁（复盘里看得到），而"活三+眠三"这种点本身可能也有价值——`split` 两者都保留且如实命名，是目前最好的候选。要定论需要 170 盘。

页面（`route.ts`）改为显式传 `"split"`。生产环境未重新部署，仍是 `legacy`。


## 20 盘 → 复盘输局 → 修 → 再 20 盘 (2026-09-23)

`scripts/ab.ts` 现在记录棋步，每轮都用同一组种子 51000–51019，复盘输局找原因再改。

### 第一轮：split 的 5 盘输局

| 种子 | 原因 |
| --- | --- |
| 51007 / 51018 | 白棋在 K6 有潜在双三，state 里没有条目。Jev 先下了没用的冲四（G4 / H5），再挡错了点 |
| 51010 | 白棋有四（B7 成五），I6 却被写成 "open four — **unstoppable**"，Jev 以 70% 下了 I6 |
| 51012 / 51015 | 白棋更早就形成了双三，同属 K6 这一类 |

修正：开放四的说法去掉结论，改为 "makes an open four (two points complete five)"；`blocks_*` 挡四时写明对方下一手在这里成五。
测试打开修正后的 `<colour>_would_make`。

`split` 13-7，`splitkey` 14-6，配对净 +1。注意 `split` 在同一组种子上上一轮是 15-5——同配置、同种子，一句措辞改动就差两盘，这就是 20 盘的噪音。

### 第二轮：Jev 看见了事实，被指令压住了

复盘 `splitkey` 的输局：输掉的那个点**带着** `white_would_make`（51001 里它是 `point_effects` 第一条），Jev 却去下了单冲四。
`PRIORITY_LEAN` 第 3 条写着 "if you can make a four, play it… so you keep the initiative"，排在除成五/挡五外的一切之前。51017 连下了 7 个单冲四，对方的关键点一直空着。

新梯子 `PRIORITY_KEY`：去掉无条件冲四；`double_threat` 含四时直接下（两个活三则只在对方没有活三和四时下）；`white_would_make` 的点排在挡活三之前；末尾说明单冲四会被一步挡住。

| 臂 | 战绩 | 单冲四占比 | `white_would_make` 出现时下在该点 | `double_threat` 出现时下在该点 |
| --- | --- | --- | --- | --- |
| splitkey（`PRIORITY_LEAN`） | 13-7 | 32% | 6/40 (15%) | 12/27 |
| **keyladder**（`PRIORITY_KEY`） | **15-5** | **22%** | **14/25 (56%)** | 15/23 |

配对净 +2（赢 4 输 2）。胜负差在噪音范围内，但**行为变化是直接测到的**：同一个事实，被采纳的比例从 15% 到 56%。
这是本项目里第一次指令明确推动了 Jev——不是加新指令，而是删掉一条和事实打架的指令。

剩下 5 盘：51010 自己做活三而没挡对方活三（违反第 6 条）；51012 挡活三挡错了一端；51011 / 51015 是长局里的深层 VCF。

页面（`route.ts`）执黑改为 `PRIORITY_KEY` + `keyPoints`；执白不变。未部署。


## 第三轮：挡哪一端 — `leaves` (2026-09-23)

`keyladder` 剩下的输局里，51012 挡活三挡了 J9 而不是 J13（J9 让白棋还能在 J14 做四三），51010 对跳三 `O.OO.` 没挡中间的 G6。
state 里两个端点的条目**一模一样**。新增 `leaves`：挡住这个点之后，那条线还能给对方做出什么——"can still make a four at …"、
"cannot make a four with one stone"、"can no longer make five"。是挡完之后棋盘的事实，和 `would_make` 同类，不点名走法。
`PRIORITY_KEY_LEAVES` 第 6 条指向它。排序：挡四 > 挡活三（死线 > 不留四 > 留四，"留四"只在同一条线另有干净挡点时才降级）> 挡眠三。

同种子 51000–51019，三次迭代：

| 版本 | keyladder | keyleaves | 配对 | 挡法不等时下在干净挡点 |
| --- | --- | --- | --- | --- |
| v1 | 16-4 | 13-5-2和 | -3 | 53/55 vs 21/35 |
| v2 挡眠三不再与挡活三同分 | 16-4 | 13-5-2和 | -3 | 41/42 vs 13/24 |
| **v3 `leaves` 只写在活三上** | 12-7-1和 | **15-4-1和** | **+3** | **30/32 vs 20/31** |

每一版的问题都是从输局复盘里找到的：
- v1：杀死一个眠三和杀死一个活三同分（27），51006 / 51010 / 51016 都是去挡了无关紧要的眠三，把对方的活三放着。
- v2：眠三上也写 `leaves`，"this line can no longer make five" 这句话本身成了诱饵，51003 里 Jev 为它放弃了对方的 `white_would_make` 点。
- v3：剩下的 51002 / 51003 是对方已经同时有两个活三。

和棋是满盘 225 手，出现在两臂里。**噪音提醒**：keyladder 在同一组种子上四次分别是 15-5、16-4、16-4、12-7——同一配置±2 盘。
胜负只能当方向看；站得住的是行为指标：挡法不等时选对挡点，从约 60% 到约 95%。

页面执黑改为 `PRIORITY_KEY_LEAVES` + `blockLeaves`。未部署。


## 第四轮：`white_would_make` 为什么没被采纳 — 移除眠三挡点 (2026-09-23)

上一轮说 `white_would_make` 出现时只有约 65% 被采纳，**这个数低估了**：分类器没把 Jev 自己的活四、冲四反击算作安全。
修正后（两次运行共 87 个局面）：下在该点 59，改下别处但安全 19，**真正的漏着 9**——其中 4 个是去挡一个眠三（51003 F12、51012 N10、51016 J8、51017 M12），3 个是对方同时还有活三（基本已输），2 个是单冲四。

眠三最多只能变成一个冲四，一步就挡住；梯子里没有一条让 Jev 去挡眠三；它若是真双威胁的一半，`white_would_make` 已经点名。
所以这一轮是**移除**：`dropBlockedThreeBlocks` 不再给眠三写 `blocks_*`。

| 臂 | 战绩 | would_make 在场时真正漏着 | 其中去挡眠三 | 下在该点 |
| --- | --- | --- | --- | --- |
| keyleaves | 14-6 | 5 | 1 | 19 |
| nobb | 13-7 | 3 | 0 | 27 |

配对净 -1，噪音以内；行为往预期方向走，state 更短。采用。

剩下的输局：单冲四后才想起对方关键点（51006 G9、51004 L11）；对方的连续冲四（51008 E11、51011 N6，这些点在 state 里没有条目）。
后者要让 state 说"对方从这里能连续冲四到五"，那等于在 state 里放了一个 VCF 搜索的结果，和 `winningReplies` 是同一类计算——**这越过了"只陈述棋形事实"的边界，没有做**。
