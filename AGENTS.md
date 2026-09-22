# AGENTS.md

Guidance for coding agents working in this repository.

## Status

Measured, corrected, measured again. Full data in [RESULTS.md](./RESULTS.md).

**Every "Jev is weak" result in this project traced back to the state encoding, twice.**

1. Stones passed as a bare coordinate list → 0/12 on forced moves. Adding a priority order to
   the instructions changed nothing (still 0/12). Adding enumerated threat relationships to the
   **state** → 12/12.
2. That enumeration walked *contiguous* runs, so every split shape was invisible: `XX.XX` — a
   four that wins next move — was reported as two "open two"s. Humans play with gaps constantly.
   Rewriting it around sliding 5-cell windows (`lib/lines.ts`) fixed it, and the same blindness
   in `lib/opponent.ts` meant the ruler was broken too.

With both fixed, Jev beats the threat-aware opponent 3-0 at even and holds to a 3-stone handicap.
**The model's actual ceiling has still not been reached** — there is no ruler stronger than L2.

Watch out for: `critical_points` precision. Listing every empty in a window instead of the ones
adjacent to the stones' span dropped accuracy from 100% to 60%. Dilution costs as much as absence.

`app/api/move/route.ts` plays 详注 (`informed: true`) unless the page asks for 素盘. The naked
convention — neither of those — is no longer reachable from the UI and survives only as a
measurement baseline in `scripts/`. It logs every UI move to `runs/ui-<date>.jsonl` (local only).

## 禁手 (Renju forbidden moves)

`lib/renju.ts`, tested by `scripts/test-renju.ts` (21 assertions). Three independent toggles:
三三 / 四四 / 長連, off by default (free-style).

Non-obvious rules this encodes — get these wrong and the game is subtly broken:
- **Black only.** White/Jev is unrestricted: white may overline and still wins with 6+.
- **五連優先**: a black move making exactly five wins even if it also forms a double-three.
- With 長連 on, black wins only with **exactly** five; 6+ is a loss, not a win.
- **四三 is legal** (a four plus an open three) — that is Renju's winning shape. Only 四四 loses.
- A three blocked on one end is not an open three and does not count toward 三三.

Definitions are one level of recursion deep: a *four* is a shape where one stone makes exactly
five; an *open three* is a shape where one stone makes an open four. **Nested resolution is not
implemented** — strict Renju discounts a three whose completing point is itself forbidden.

Bug worth remembering: `isOpenThree` originally reported true for shapes that were *already*
fours, because dropping an irrelevant stone elsewhere on the line left the existing open four
standing. That made 四三 judge as 三三. The guard is `if (isFour(...)) return false`.

The active rules go into Jev's `state` so it does not read black's overline as a threat, and
`forbiddenPoints()` drives the cinnabar crosses on the board.

## Exploiting black's 禁手

`lib/exploit.ts` (tested by `scripts/test-exploit.ts`, measured by `npm run trap`). When 禁手 is
active, `buildState` adds a `forbidden_analysis` field carrying two relationships:

- `black_threats_that_cannot_be_completed` — a black line whose every critical point is
  forbidden. It can be ignored.
- `white_moves_black_cannot_answer` — a white move making a four whose only completion point is
  forbidden for black.

**The encoding states facts and stops.** It emits
`{white_plays: "G5", completes_five_at: ["F5"], black_may_block: false, reason: "..."}` and never
`winning_move`. Jev draws the conclusion. Hold this boundary — it is the thing being measured.

Forbidden status is recomputed on the board **after** white's candidate move, because white's own
stone can dissolve the black shape that made a point forbidden.

Measured on strict fixtures (6 positions x 3 runs): **16/18 with the facts, 0/18 without**.

**This measurement was wrong twice — read `scripts/test-trap.ts`'s validation before trusting a
new fixture.** A position only isolates the 禁手 variable when all of these hold:
1. Black has no immediate five (otherwise blocking beats any trap and the "trap move" loses).
2. White has no immediate five.
3. The trap move makes a **simple** four, not an open four — an open four wins with or without
   禁手.
4. **No other white move makes an open four.** This one cost the most: white's three sitting
   beside black's pinned line means the forbidden point is often white's *own* open-four square,
   so playing it is correct and the fixture measures nothing.

**Jev may now play either colour** (the 先/後手 toggle in the UI). Two consequences:
- `lib/effects.ts` names its keys for the *colours*, not for "me"/"them": `for_white`/`blocks_black`
  when Jev is white, `for_black`/`blocks_white` when it is black. Read them through the `mine()` /
  `theirs()` helpers. A field called `for_white` describing what black builds is exactly the
  state-encoding lie that every "Jev is weak" result traced back to.
- `app/api/move/route.ts` judges Jev's move with `outcomeOf`, **not** `isWinningMove`. The latter is
  free-style and calls six-in-a-row a win — right for white, wrong for black under 長連.

**The one place forbidden points ARE removed from the option set**: `nakedJevMove` drops them when
**Jev plays black** and a rule is on. That is Layer 0 — a forbidden point is an instant loss, so it
is not a legal move at all. It is not the idea rejected below, which is about Jev as *white*.

**"Just remove forbidden points from Jev's options" does not work.** It was tested and removed —
do not re-add it (this is about Jev as WHITE):
- 禁手 binds black only. White may play those squares, and they are frequently white's own
  winning square, so blanket removal deletes white's win.
- 三三/四四 forbidden status is **dynamic** — white blocking one of the threes makes the point
  legal again. Only 長連 is stable.
- A safe version (remove only forbidden points that give white nothing) pruned **zero** options
  on the strict fixtures, because wherever the trap exists the forbidden point also makes a four
  for white. So it is a no-op where it would matter, and a footgun everywhere else.

## The priority ladder follows the seat

`PRIORITY` in `lib/jev.ts` puts three *blocks* above the player's own offence and ends with
"defence takes priority" — right for white, who reacts, wrong for black, who opens. Jev can now
play either colour, so `app/api/move/route.ts` picks: `jev === 1 ? PRIORITY_INITIATIVE : PRIORITY`.
Measured even vs L2, 8 games: black 8-0 in **18.3** plies with the initiative ladder vs 8-0 in 20.8
without, and stronger shapes at every phase. **One loss in 12 under a 2-stone handicap** — under a
handicap the initiative is not black's, and an attacker's prior may be wrong there. See RESULTS.md.

Instructions alone still move nothing — `PRIORITY` scored 0/15 without `lines_on_board`. This works
because the state already makes the position visible; it changes how Jev *weighs* what it sees.

## `double_threat` — the one state field that measurably raised black's win rate

`point_effects` collapses every point to its single strongest shape, so a move making a four AND an
open three is indistinguishable from a plain four — and that shape is how gomoku is actually won.
`double_threat` lists both, and only fires when there are two or more **forcing** shapes — a four,
or an **open** three (a handful of points per game; entry counts are unchanged, so it is not the
`builds_on` dilution again). `scripts/test-double-threat.ts` holds the definition.

**The +8.2pp below was measured on a broken definition.** Until 2026-09-23 the field counted any
three, blocked or not, so two blocked threes — which force nothing — were labelled 四三 / 双三 and
sorted (+45) above a real four. In the logged human games that was 70 of 131 labels; one human-game
loss (ply 24, G9 at 55% over the correct K13) was exactly that. The fixed field agrees with
`countFours + countOpenThrees >= 2` from `lib/renju.ts` on every logged point except five-plus-three.
The fix is **unmeasured** — re-run `scripts/ab.ts` before quoting a number for it.
`DoubleThreatMode` (`lib/effects.ts`) keeps all three definitions: `legacy`, `fixed` (what `true`
means), and `split` — `fixed` plus `shapes_on_two_lines` for the points `legacy` mislabelled, ranked
exactly as `legacy` ranked them. 20 paired games vs L3: legacy 11-9, fixed 11-9, split 15-5 (p = 0.125).
Most discordant games diverged before the field was involved, because **any wording change in the
state reshuffles near-tied points** — replay `runs/ab-*.jsonl` (it now logs moves) before reading a
small A/B as mechanism. `ARMS=legacy,split BASELINE=legacy scripts/ab.ts 170`.
`shapes_on_two_lines` is **not `builds_on` again**: it adds no entries and no "two"s — the same
points `legacy` mislabelled. It first kept legacy's +45 rank too; that was lowered to +12 because it
put two blocked threes above every real block of an open three (seed 51010).

**`leaves`** (beside a `blocks_*` three): what that line can still make for the opponent once the
point is taken — "can still make a four at …", "cannot make a four with one stone", or "can no
longer make five". The two ends of an open three are not equal, and before this field they read
identically (51012: J9 left a four at J14, J13 killed the line). A block that leaves a four gets no
attack-while-defending bonus and ranks below one that does not. `PRIORITY_KEY_LEAVES` item 6 points at
it; `leaves` is written on **open** threes only (on a blocked three its "can no longer make five" read
as a reason to play there). `dropBlockedThreeBlocks` then removes `blocks_*` for blocked threes
entirely — the commonest remaining lure away from `white_would_make`. The page sends all of it for black.

**Where the facts stop.** The remaining losses are the opponent's continuous-four (VCF) starts, which
carry no entry. Stating "white can four-chain to five from here" would put a search result in the
state — the same computation as `winningReplies`, which the owner has ruled out as cheating. `app/api/move/route.ts` passes `"split"`; never pass bare `true` there.
`<colour>_would_make` had the same defect, so its p = 0.37 rejection was of the broken version too.

**Measured +8.2pp over 680 games against L3, pooled McNemar p = 0.014**, for the black seat only.
See RESULTS.md: the replication reproduced the direction at +5.3pp rather than the discovery run's
+11.1pp, so believe the smaller number. `app/api/move/route.ts` now enables it for **both seats** —
asked for, not measured, on white. The field is computed for the seat Jev holds, so as white it
describes white's own shapes. Do not "fix" it back to black-only without being asked.

Two lessons from that campaign, both expensive:
- **A 12-game A/B against a ~43% baseline ranks candidates at random.** `double_threat` screened at
  net 0 and was nearly dropped; the arm that led the screen 9-3 turned out to change Jev's move in
  1 opening out of 8. Use `scripts/ab.ts` (parallel, ~170 games/arm, paired + McNemar), not
  `colour-check`, to decide anything.
- **A good mechanism story is not evidence.** `<colour>_would_make` was built from a measured
  failure (`scripts/test-forced.ts`: Jev misses 65% of the moves that defuse an opponent's coming
  double threat, while missing 0% of immediate fives), aimed exactly at it, and demonstrably added a
  fact the state could not previously express. It measured p = 0.37 — **on a definition that counted
  blocked threes** (see below). Fixed, and paired with `PRIORITY_KEY`, it is now **on for black**.

**`PRIORITY_KEY` (black, 详注).** Replay showed Jev *saw* `white_would_make` on the point that beat it
and played a plain four, because `PRIORITY_LEAN` item 3 said "if you can make a four, play it". The
new ladder drops that rule and gives `double_threat` / `white_would_make` their own rungs. Over 20
paired games the take-rate of the `white_would_make` point went 15% -> 56% and plain fours 32% -> 22%
(15-5 vs 13-7). The instruction that moved Jev was a **removed** one that contradicted the state.

`lib/transport.ts` now retries 429/529/5xx and network failures with jittered backoff, which
this file had specified from the start and nothing implemented. It matters at measurement scale:
the old harness scored an errored game as a LOSS.

## The second pass — round two, one request per candidate

`nakedJevMove({ verify: true })`. Round one is unchanged. Round two takes round one's top
`VERIFY_TOP_K` (3) candidates and, **for each, issues its own request against the board as it would
stand after that move**, asking two `noul` questions:

- `unanswerable` — does Jev now have a threat the opponent cannot fully answer with one stone?
- `refuted` — does the opponent now have a forcing win?

**One request per candidate, not more questions in one request.** Both questions are about the
position AFTER the move, and a `systemOne` call carries one state. This is the same mistake
`predicted_reply` already made once, predicting the opponent against a board without Jev's stone on
it. The three requests run in parallel, so the cost is one round trip.

Policy lives in code, never in the prompt: `score = p1 + VERIFY_ALPHA * (unanswerable - refuted)`,
with `VERIFY_TOP_K`, `VERIFY_ALPHA` (0.5) and `VERIFY_GATE` (0.9 — skip the pass when round one is
already that sure) all exported constants. The raw answers are kept in `MoveTrace.verified`, so
retuning any of them costs no inference. A failure in round two is caught and round one stands.

Two things that will look like bugs and are not:
- `latencyMs` is reassigned after the pass. It is what the player waits for, so it has to include it.
- The prediction request and the returned trace use `chosen`/`chosenIdx`, not round one's
  `best.choice` — otherwise Jev would predict the reply to a move it did not play.

**Measured against L3, 12 games per arm on identical seeds: 8-4 without it, 7-5 with it — no gain,
so it is NOT wired into `app/api/move/route.ts`.** It stays available behind the flag because the
calibration says the mechanism works and the policy is what is wrong: over 216 candidate judgments
`unanswerable` separates true from false by +0.240 and `refuted` by only +0.170, yet both carry the
same weight — and across 10 switches the pass was 1 better, 2 worse, 7 neutral. Full numbers and a
pre-registered next step in RESULTS.md. Do not re-enable it without re-measuring.

**The scoreboard cannot see this feature.** The pass only changes anything on the moves
where it switches, which is single digits per run. Judge the questions directly:
`scripts/test-verify.ts` ground-truths every candidate against L3's own tactics (does Jev still hold
a winning point after white's best reply? does white hold one?) and reports the separation between
what Jev says on the true cases and the false ones.

## The ruler: L3, and why L2 could only reject things

`lib/opponent.ts` L0-L2 are random / greedy / one-ply-threat. **L2 is saturated against Jev-as-black
(8-0 at even), so against it a candidate improvement can only be measured as harm** — which is
literally how both rejections below were produced. L3 exists to make black's win rate measurable:

- **VCF** (continuous fours, depth 8, 400-node budget), **双威胁** (四三/双三 via `countFours` /
  `countOpenThrees` from `lib/renju.ts`), and a **one-step veto** on the opponent's winning replies.
- 20-0 as black and 19-1 as white against L2; ~10ms/ply. `npm test` includes `scripts/test-l3.ts`.
- `npm run colour` defaults to L3; `JEV_LEVEL=2` reproduces the older runs. `npm run ladder [games]
  [maxLevel]` reaches it with `maxLevel` 3.

Two traps it was built out of, both of which look like working code:
- **A plain four is not a win.** Asking "does this player now have a five-completion point" is true
  of every four, and a four is just blocked. `vcfAfter` judges a move as the *first forcing stone*:
  no completion → not forcing, one → the opponent blocks and the search continues, two → open four.
- **A veto that can only filter is not a defence.** The saving move usually scores near zero for the
  defender, because `scorePoint`'s `denied` term is a MAX over the opponent's lines and blocking one
  of two threes lowers that max by nothing. `winningReplies` generates the opponent's key points
  from geometry — every four-making point, plus every point critical to two threats in *different*
  directions — and the defence chooses among those. Do not replace it with a top-K by static score:
  those scores tie constantly and the slice drops the key point.

## 開盤直線 — real, and both obvious fixes were measured and rejected

Jev as black builds along one straight line: `1-line` (share of its own stones on a single line)
is 0.61 in the midgame vs white's 0.45. Two causes, both verified: the ladder's last building rule
literally says "extend your own longest line", and `pointEffects` collapsed each point to its
single strongest shape, so a point lying on two of Jev's lines was indistinguishable from one
extending a single line (and multi-"two" points were dropped entirely).

**Both fixes made Jev worse and neither is shipped — do not re-add them blind:**
- `builds_on` in `point_effects` (`multiAxis`, default `false`): 6-2 vs 8-0, **zero** effect on the
  opening. It cannot work there — `point_effects` is empty with one stone on the board — and later
  it diluted the list from 15 entries to 24.
- `PRIORITY_SHAPE` ("build width, not length"): 7-1 vs 8-0, opening moved 0.04, late play much
  less certain.

See RESULTS.md. L2 may not punish a straight line the way a human does, so it may be the wrong
ruler for this particular complaint. Telling Jev the 执黑先行 experience for the first four stones
only (`PRIORITY_OPENING`) was the opening-scoped version of that rewrite. Against L3, 5 paired
seeds, both arms finished 4-1 with the same wins and the same loss. Ranking a diagonal
step off that line above "make an open three" (`PRIORITY_DIAGONAL`, seeds 13000–13004)
did move the opening, onto one diagonal instead of one horizontal, and lost 4 of the 5
games the straight opening won. The same inversion for the whole game
(`diagonal_branches` above the open three, seeds 14000–14004) lost the only game
whose result changed. Do not put a diagonal two back above an open three.

详注 now sends `PRIORITY_LEAN` / `PRIORITY_LEAN_WHITE` with `leanDiagonal`. An open
three stays above a diagonal step. When several points make an open three, the
diagonal one is preferred. Blocking the opponent's open three stays above making
your own — their open three becomes an open four if it is left for a move.
`diagonal_branches` is only reached when no open three can be made or blocked.
With one stone the list is the empty diagonal neighbours. With a diagonal that
is blocked on both ends, the list is the other diagonal.

## point_effects — what a move would create

`lib/effects.ts`. `lines_on_board` describes shapes that already exist, so a point that blocks
black *and* extends white reads identically to one that only blocks. `point_effects` adds, per
nearby empty point, `for_white` (what it builds) and `blocks_black` (which threat it answers).
A point carrying both fields is a dual-purpose move. **There is no `dual_purpose` flag and no
"prefer these" note** — co-occurrence is the fact, and the ordering puts both-field points first.

Measured two ways, and the honest answer is mixed:
- Single black three, one attacking block vs one plain block: **18/18 with, 18/18 without.**
  No difference — Jev already picks the better block when the position is clean.
- Full games vs the L2 opponent, 6 each: both win 6/6, but with the field games end in **19.7
  plies vs 27.0**. It helps finishing, not defending.

Cost: +6% input tokens (3378 → 3584), no latency change.

L2 is a poor proxy for a human, and this was never measured against one.

## 素盘

The 对局 card switches what Jev is told. 详注 is the informed state described above. 素盘
(`brief: true` on `/api/move`, `buildBriefState` in `lib/jev.ts`) sends four facts:

- this is 五子棋
- which colour Jev holds
- the board as it stands — the diagram plus the two stone lists
- whether 禁手 is on, and if so which rules, stated as facts

No `lines_on_board`, no `point_effects`, no move history, no `forbidden_analysis`, and the move
question carries no `priority_order`. Both seats. The same observation questions (`position`,
`opponent_threat`) are still asked, because those drive the trace card; they are not part of the
briefing. Layer 0 still drops black's forbidden points from the option set — a forbidden point is
an instant loss, not a hint withheld. Unmeasured. Do not enrich `buildBriefState` without being
asked, and do not fold it back into `buildState`.

## UI

`app/board.css` + `app/page.tsx`. Theme is 文人棋局 — xuan paper, pine-soot ink, kaya wood,
cinnabar seal. Fonts: Ma Shan Zheng (brush) for headings, Noto Serif SC for body.

Things that will bite you if you edit it:
- Stones sit on **intersections**, not in cells. Each `.pt` draws half grid-lines through its own
  centre via `::before`/`::after`, clipped at the board edge by `data-edge`.
- The board sizes from `--board: min(94vw, 78vh, 620px)` with `aspect-ratio: 1`. Everything
  inside is a percentage of that, so it scales to phones with no media query for the board
  itself. Verified at 390x844: 367px board, 22.7px cells, no horizontal scroll.
- **Wood grain must stay coarse.** A previous version used 6px `repeating-linear-gradient`
  stripes, which read as extra grid lines and made the board look like a barcode.
- `.bar-track` / `.bar-fill` need explicit `display: block`. They are `<span>`s, and as inline
  elements their width was ignored — every probability bar rendered at 0px wide.
- The heatmap uses `sqrt(p / maxP)` so mid-probability points stay visible; a linear ramp made
  everything but the top choice invisible.
- **Jev's move is staged in three beats**, not applied in one go. In `play()`, after the response:

  ```
  setTrace(t)                 wash + trace card appear; the target is still EMPTY,
                              so the chosen point lights up at full strength
    await HEAT_DWELL (700)
  setHand(idx)                the hand comes in
    await HAND_REACH (480)    (52% of the 900ms keyframe — it arrives here)
  setBoard / bloom / winLine  the stone lands under the hand
    await HAND_TOTAL-REACH    the hand withdraws
  ```

  That is **~1.2s of deliberate delay** on top of the ~350ms API call, and it is the feature, not
  a stall. Two consequences to know: the trace card names Jev's move ~1.2s before the board has it
  (it reads as a prediction, which is fine), and `trace.latencyMs` likewise shows early.
- **Jev places its stone with a hand** (`app/hand.tsx`, `.hand` in `board.css`). Two things about
  it are deliberate and will look like bugs:
  1. **`setBoard` is held back** — see the sequence above. Placing the stone first and waving a
     hand over it afterwards is theatre nobody believes. `thinking` stays true throughout, so the
     board is already disabled — no new guard. `handShown` is a **ref**, not state: the `finally`
     block reads it after an await, where the `hand` state variable is the stale render-time
     value (always `null`).
  2. **The hand is a child of `.grid`, not of a `.pt`.** A `.pt` is 22–41px square; a hand 4.2
     cells wide cannot be positioned against one.
  Sizing trap: **do not write `calc(var(--cell) * 4.2)` inside `.grid`.** `--cell` is
  `(100% - pad*2) / n` resolved against `.goban`'s containing block; re-resolving it one level in
  subtracts the padding a second time and the hand comes out ~9% small. `.grid` is exactly `n`
  cells wide and square, so use `calc(4.2 / var(--n) * 100%)`.
  The hand is `public/jev-hand.png`, **generated with Codex's image tool**
  (`codex exec --enable image_generation`; `image_generation` is a stable feature flag). It went
  sumi-e line drawing → rendered SVG → cut-out CC BY photo → Codex-drawn SVG → this, over five
  rounds. The photo was dropped because a photograph next to a CSS-drawn board reads as pasted on
  and its sleeve was camouflage; **its CC BY credit footer went with it** — never leave a stale
  attribution behind when the art changes.

  Driving Codex for this, if it needs redoing: a written brief with the palette, the composition,
  and "transparent background" stated as a hard requirement, plus two reference screenshots via
  `-i`, plus a `check.sh` that reports alpha coverage and corner transparency and composites the
  result onto the real board colour **at true on-screen size** — so it can look at its own output
  and iterate rather than generating blind. `codex exec`'s `-i` is variadic, so the prompt must go
  on **stdin**, not as a trailing argument.

  Post-processing the generated PNG (all of it scripted, see the scratchpad):
  - **De-fringe.** The generator leaves a red/yellow halo on semi-transparent edges — visible as a
    red outline at 3x. Pull saturated edge pixels toward grey where alpha is 8..225.
  - Trim to the alpha bounding box, then measure the held stone.

  Geometry contract — every number in `.hand` derives from these:
  - The **held stone in the art is 0.88 board cell by definition** — that is what fixes the scale.
    Measured 150px across in the 1128px-wide trimmed image => the art covers **6.6176 x 7.2336
    cells**, pinch at **7.604% / 15.122%**.
  - **To make the hand look smaller, change how many stone-widths the drawing measures** — that is
    the only lever, since the stone's on-board size is fixed. Put the target in the brief as a
    ratio and have `check.sh` print it, so the model can converge on it: "the image should be
    about seven stone-diameters across, no more than eight". The first generation came out at
    11.1 and read as oversized; the current art is 7.5.
  - The app's `.hand-stone` is laid exactly over the painted one, same centre and diameter, so the
    stone being carried is literally the stone that lands.
  - **Do not scale the wrapper to resize the hand.** `.hand-stone` is a percentage of the wrapper,
    so scaling takes the held stone off 0.88 cell and it stops matching the board's stones.
    Regenerate the art instead. (Tried 1.3x on an earlier version; the held stone went to 1.18.)
  - `<img>`, not `next/image` — it is an animated overlay sized in `%` of `.grid`. The `src` needs
    `${BASE_PATH}` prepended; basePath does not rewrite a plain `src`.

  **Measuring the alignment: clone the element with `transform: none` first.** The live `.hand` is
  mid-animation and `getBoundingClientRect()` includes the transform — measuring it directly
  reports a drift that is not there, and "correcting" it breaks the alignment. Verified drift on
  the untransformed clone: 0.000 cells in both axes.

  `prefers-reduced-motion` skips the hand and **both** delays; the heatmap still appears, since
  that is information rather than motion.
  On a Jev win the withdrawing hand covers one stone of the five for ~420ms. Checked, accepted.
- **Every board layer needs an explicit `z-index`.** The grid lines are `.pt::before/::after` and
  the stones are child elements; all are `position:absolute` with `z-index:auto`, so they paint
  in tree order and the vertical line drew *on top of the stones*. Layers are: lines 0, star 1,
  heat wash 2, ink bloom 3, stone 4, Jev's hand 5.
- **`html { scrollbar-gutter: stable both-edges }` (`globals.css`) is load-bearing.** Without it
  the trace card pushing the page past the fold makes a classic desktop scrollbar appear, the
  viewport narrows ~15px, `.shell`'s auto margins recentre and `.meta` rewraps — the page twitches
  mid-game. `both-edges` rather than plain `stable` because the shell is centred; a right-only
  gutter parks it 7.5px off-centre permanently. **Headless Chromium uses overlay scrollbars and
  cannot reproduce the jump** — `innerWidth - clientWidth` stayed 0 in every run, and forcing
  `::-webkit-scrollbar { width: 15px }` did not change that. Verify the *reservation* instead:
  `.shell` left is 160 at 1440px wide with `auto`, 152.5 with `stable`, and 160 again with
  `stable both-edges` — gutter reserved, shell still centred.
- `.status-head` wraps the playing/ended block in the status card with a `min-height`. Playing is
  `h2` 20px, ended is `.verdict` 27px; without the floor, the 讓子 and 禁手 cards below jump the
  moment the game ends. Measured: 72px in both states, `.dial--wide` top unchanged at 267.
- 讓子 and 禁手 share one 對局 card; 禁手 is a `<details className="fold">` **left uncontrolled on
  purpose**. `rules` always starts `FREESTYLE`, so it opens closed; an `open={anyRule}` prop would
  slam the fold shut under the user the moment they unticked the last rule. The summary carries
  the active rules so folding the checkboxes away does not hide what is on — and it uses the short
  labels from `FORBIDDEN_ROWS`, not `RULE_NAME`, which carries a "…禁手" suffix and would read
  "禁手 · 三三禁手".
- The UI offers only a 0- and 1-stone handicap. `placeHandicap` lays stones **collinear**, so
  n=3 is an open three before the first move and n=4 is already won — fine as a severity dial for
  the ladder, absurd as something to play against. Scatter onto star points before offering more.

## Project

A Gomoku (五子棋) web game: human vs. **Jev**, deployed on Vercel. The point of the project is
not the game — it is to make Jev's capability legible to whoever plays it.

## Deployment

Live at **https://hanxl.com/wuziqi** (Vercel project `chris-hans-projects/wuziqi`). The
`*.vercel.app` preview URLs sit behind Deployment Protection — an unauthenticated request gets a
302 — but the custom production domain is exempt and serves publicly. Verified in production:
page renders, `/api/move` blocks a split four at J8 over the `native` transport, and the client
bundle contains no key.

**The app runs under `basePath: '/wuziqi'`** (`next.config.ts`, from `lib/base-path.ts`).
basePath prefixes routes, `next/link` and `_next` assets — it does **not** prefix `fetch()`.
Every client call to an API route must prepend `BASE_PATH` explicitly; a bare `fetch('/api/move')`
compiles, renders fine, and 404s on the first click. `hanxl.com/` itself 404s by design — only
`/wuziqi` is served.

DNS: `hanxl.com` is registered at Spaceship on its own nameservers (`launch1/2.spaceship.net`),
with two apex A records pointing at Vercel: `216.198.79.1` and `64.29.17.1`. Do **not** trust
`vercel domains inspect`'s legacy `76.76.21.21` suggestion — `vercel domains verify` prints the
current pair.

```bash
npx vercel deploy          # preview
npx vercel deploy --prod   # production
```

Production env: `JEV_TRANSPORT=native`, `TYPESAFE_API_KEY`, plus `AI_GATEWAY_API_KEY` staged for
the gateway switch (see the free-tier note under transports). `.vercelignore` excludes
`.env.local`, `runs/`, `scripts/`, `.claude/`, `.vercel/` — `vercel deploy` uploads the working
directory as-is (it is not wired to git), so that file is the only thing standing between the key
and the build. Verified with a clean-room build from a copy with those paths stripped.

Source is **public** at https://github.com/chrishan17/wuziqi (created 2026-09-23). `.gitignore`
covers `.env*` and `runs/`; `.env.example` is force-added and holds no values. Before any push,
grep the diff for the key — the history was scanned clean when the repo went public.

**`npm run build` breaks a running `npm run dev`** — both write `.next`, and the dev server starts
returning 500 with 404 assets. Stop dev, `rm -rf .next`, restart it after building.

**Vercel's filesystem is read-only**, so `logMove()` in `app/api/move/route.ts` no-ops when
`process.env.VERCEL` is set. UI game logs only exist locally.

## Commands

```bash
npm install
npm test          # pure rules + probe fixture verification, no network, no key needed
npm run typecheck
npm run dev       # http://localhost:3000/wuziqi  (basePath)
npm run build
npm run probe     # baseline measurement against Jev — needs a key (see below)
```

`npm run probe` takes an optional mode: `limits` (how many choice options does the API
accept?), `tactics` (4 positions with known-correct answers), `selfplay` (Jev vs a random
mover). Default runs all three and appends every move to `runs/probe-<timestamp>.jsonl`.

Env: copy `.env.example` to `.env.local`. Server-side only — never `NEXT_PUBLIC_*`.
Two transports, selected by `lib/transport.ts`:

| `JEV_TRANSPORT` | key | notes |
| --- | --- | --- |
| `gateway` (default) | `AI_GATEWAY_API_KEY` | Vercel AI Gateway. See the free-tier note below. |
| `native` | `TYPESAFE_API_KEY` | TypeSafe's own API by plain fetch. No Vercel billing involved. |

**Gateway free tier, re-verified 2026-09-20.** The old failure mode (`GatewayInternalServerError:
AI Gateway requires a valid credit card on file`) is gone — a card is on file and calls now
authenticate. The blocker is now the **free-tier quota on `typesafe-ai/jev`**, and it is tight
enough to make the gateway unusable for play:

- The first call of the session succeeded (`H7`, 1487ms, identical answer and token count to
  native — 2994 in / 1918 out, probabilities within 1pp).
- Every call after it failed, including with 10s, 20s and 30s of spacing:
  `AI_RetryError → GatewayRateLimitError: Free tier requests on this model are rate-limited.
  Upgrade to paid credits.` Three SDK retries each, all refused. So it is a credit cap, not a
  burst limit — waiting does not help.

**Production therefore stays on `native`.** `AI_GATEWAY_API_KEY` is set in production so the flip
is one `vercel env` command once paid credits exist. Measured latency, native, n=5, same position:
min 374 / median 417 / max 843 ms.

The two differ only in the yes/no primitive: the AI SDK calls it `boolean` and returns
`probability`; TypeSafe natively calls it `noul` and returns `noul`. `lib/transport.ts`
translates both directions so `lib/jev.ts` asks once.

Optional: `BOARD_SIZE` (default 15), `JEV_MODEL` (gateway, default `typesafe-ai/jev`),
`JEV_NATIVE_MODEL` (native, default `jev-latest`).

## What Jev is, and why it dictates the architecture

Jev is a **System One evaluation model**, not a generative one. It does not emit text or a move.
It takes a `state` plus a map of typed `questions` and returns typed answers with calibrated
probability distributions. Three primitives only:

| Primitive | Returns | Use for |
| --- | --- | --- |
| `choice` | `choice` (chosen option) + `probabilities` map | pick one move / one plan from an option set |
| `boolean` (`noul` natively) | `probability` = P(true) in [0,1] | "is this an unstoppable double threat?" |
| `score` | `score` (weighted position over ordered levels) + `probabilities` | positional evaluation |

Verified contract (2026-09-19):
- Direct: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`,
  body `{ state, model, questions }`, model `"jev-latest"`. Errors: 401 / 422 / 429 / 529.
- SDK: `@typesafe-ai/sdk` (Node 20+), `new TypeSafeClient().systemOne({ state, questions })`.
  Config accepts `baseURL` and `defaultModel`, so it can be pointed at a proxy.
- **Vercel AI Gateway (what this repo uses)**: model id `typesafe-ai/jev`,
  `"type": "evaluation"`. It is *not* a chat-completions model and has no raw `/v1/systemone`
  route on the gateway host. `@ai-sdk/gateway` types it as
  `GatewayEvaluationModelId = 'typesafe-ai/jev'` and is a direct dependency of `ai`, so a plain
  string model id resolves through the default gateway provider reading `AI_GATEWAY_API_KEY`.
  Called through the AI SDK's evaluate API:

  ```ts
  import { experimental_evaluate as evaluate } from 'ai';

  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: { /* board, candidates, history */ },
    questions: {
      refunded: { type: 'boolean', instructions: 'Was a refund issued?' },
    },
  });
  ```

  Naming drift to watch: the AI SDK spells the yes/no primitive `'boolean'`, while TypeSafe's
  native API calls it `'noul'`. `choice` and `score` keep their names. Keep the whole question
  set in one module so swapping transport is a single-file change. The API is `experimental_*`
  — pin the `ai` version and re-check it on upgrade.
- Pricing: input `$0.042 / 1M` tokens, output free. Per MOVE that is nothing — one move can afford
  30+ parallel questions, so design for fan-out, not frugality.
  **But "effectively free" stops being true at measurement scale, and it bit hard once:** a single
  session of A/B runs (~1,050 games, ~16.7k requests, ~57M input tokens) **exhausted the
  organisation's TypeSafe credits and took production down with a 402**, because `npm run dev`, the
  scripts and the deployed app all use the same key. Before a run of this size, check the balance at
  https://console.typesafe.ai/settings/billing and budget it: at ~3.4k input tokens per move and
  ~16 Jev moves per game, **a 170-game arm is ~9.3M tokens**. A 402 is a billing error, not a
  transient one, so `lib/transport.ts` deliberately does not retry it.

Consequences for this codebase:
1. Code must enumerate candidate moves. Jev cannot name a coordinate that isn't in `criteria`.
2. All independent questions for one move go in **one** request — they run in parallel and
   cannot see each other's answers. A second round trip is only justified when an answer is
   needed to build new state (e.g. narrowing candidates after a first pass).
3. Anything decidable by a `for` loop stays in a `for` loop. Jev is for the semantic judgment.

## Architecture: the three-layer move engine

The central design rule: **the layer split is the difficulty dial.** Strength comes from how
much tactical work code does; the *showcase* comes from what Jev is left to judge.

```
Layer 0 — Rules (pure TS, deterministic, always on)
  board state, legal moves, five-in-a-row detection, win/draw
  → never let Jev lose to something a loop prevents

Layer 1 — Candidate generation (pure TS, pattern scan)
  cells adjacent to existing stones, pattern-matched and labelled:
  open-three, closed-three, open-four, split-four, double-three, block-*
  → emits 8-12 candidates, each with coordinate + tactical label + local line context

Layer 2 — Jev (one fan-out request per move)
  the genuinely hard part of gomoku: which threat to pursue, attack vs. defend,
  whether the opponent's shape is actually dangerous
```

Layer 2's question set (all in one `systemOne` call):
- `best_move` — `choice` over the Layer 1 candidates. The move.
- `predicted_reply` — `choice` over where the human will play next. Drives the "预判" UI.
- `threat_<n>` — `noul` per candidate: "does this create a threat the opponent cannot answer?"
- `position` — `score`: who is ahead, on ordered levels. Drives the live win-probability bar.
- `opponent_style` — `choice`: aggressive / defensive / scattered. Code re-weights accordingly.

Board encoding for `state`: a **stone list** with coordinates and tactical annotations, not a
flat 225-cell grid. Named JSON fields (`board`, `candidates`, `history`, `threats`). Reference
nested paths in instructions with backticks, e.g. `` `candidates[3].pattern` ``.

## Difficulty levels

Implemented by moving the Layer 0/1 ↔ Layer 2 boundary, not by handicapping Jev's answer:

- **入门** — code plays all forced tactics; Jev chooses freely from a wide candidate set.
- **标准** — code only enforces win-now and block-four; Jev owns the rest.
- **大师** — code only detects five. Jev gets a two-pass loop: fan-out over a wide candidate
  set, then a second request that verifies the top 3 with per-candidate `noul` double-threat
  checks before committing. 30+ questions per move; still fractions of a cent.

Separately, a **handicap toggle** (human opens with two stones, or a larger board) exists for
the opposite reading of the goal — making Jev's win harder to achieve rather than harder to
prevent. Keep the two orthogonal.

## Surfacing Jev's capability in the UI

This is the product, not decoration. Every item below exists because Jev returns *calibrated
distributions*, which a generative model does not give you:

- **Heatmap** — `best_move.probabilities` painted onto the board, live.
- **预判 (prediction)** — show `predicted_reply` *before* the human moves, then reveal whether
  it was right. Highest-impact feature; keep a running "Jev 看穿了你 N 次" counter.
- **Win-probability bar** — driven by the `position` score, updating every ply.
- **Certainty gating** — note the AI SDK's V4 answers carry **no `confidence` field** (unlike
  TypeSafe's native API); derive certainty from the `probabilities` distribution yourself, e.g.
  top-probability or normalised entropy. Low certainty widens the candidate set and triggers a
  visible second pass; high certainty moves instantly. The hesitation should be real.
- **Post-game scorecard** — prediction hit rate and a calibration curve.

**Prediction is a second request, deliberately.** `predicted_reply` used to ride along in the
parallel pass with `best_move`, which meant Jev predicted the human against a board *without its
own stone on it* — it repeatedly named its own square. `nakedJevMove` now applies the chosen move
first and issues a separate `evaluate` for the prediction against the real position. Do not merge
it back for latency; the answer becomes meaningless. A failed prediction is caught and never
costs Jev its move.

## Testing

Layer 0 and Layer 1 are pure functions and must be unit-tested without network access:
win detection, pattern classification, candidate generation on known board positions.
Layer 2 needs recorded-fixture tests (saved `systemOne` responses) plus a small suite of real
games to measure actual strength. Do not claim a difficulty level works without playing it.

## Conventions

- Keep raw Jev answers in state and apply policy (weights, thresholds) in code, so tuning a
  weight does not require re-running inference.
- Typed output guarantees shape, not correctness — validate Jev's move is legal before applying.
- Handle 429/529 with backoff; a failed request must fall back to the Layer 1 top candidate
  rather than hanging the game.
