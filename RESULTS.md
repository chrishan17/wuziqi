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
