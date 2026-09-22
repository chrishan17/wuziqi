# Prompt: a canvas + audio "HTML video" introducing Gomoku vs Jev

Build **one self-contained HTML file** (`video/intro.html`) that plays a ~70-second video, drawn
entirely on a `<canvas>` with a soundtrack synthesised in Web Audio. No video files, no images, no
audio files, no JS libraries. Google Fonts via `<link>` is the only external request allowed.

The audience is people who build with AI. The tone is calm, precise, a little poetic: an ink
painting that explains an engineering idea. High-level only: no code on screen, no jargon beyond
what is defined on screen.

## Format

- Canvas 1920x1080, scaled with CSS to fit the window (letterboxed, `object-fit: contain`
  behaviour), on a dark ink background outside the frame.
- Every frame is a pure function of time `t` in seconds: `draw(t)`. No state that depends on frame
  count, so playback and recording look identical at any frame rate.
- A centered "Play ▶" button (browsers block audio until a gesture). Space toggles pause.
- **Record mode**: when the URL has `?record=1`, start automatically (assume autoplay is allowed),
  record `canvas.captureStream(60)` plus the audio (route the master gain into a
  `MediaStreamAudioDestinationNode` as well as the speakers) with `MediaRecorder`
  (`video/webm;codecs=vp9,opus`, fall back to vp8), and when the timeline ends set
  `window.__videoBlobUrl` to an object URL of the result and `window.__done = true`.
- Wait for `document.fonts.ready` before the first frame.

## Look

Literati ink (文人棋局): warm xuan paper `#efe6d2` with a faint fibrous texture drawn procedurally
(a few hundred low-alpha strokes, seeded, drawn once to an offscreen canvas), pine-soot ink
`#1f1b16`, kaya-wood board `#d9b36c` with *coarse* grain (wide soft bands, never thin stripes), and one
accent: cinnabar seal red `#b3322a`, used sparingly.

Type: **IM Fell English** (headings, via Google Fonts) and **EB Garamond** (body). A small cinnabar
square seal reading `棋` in the corner of the title and end cards (Noto Serif SC for that one glyph).

Motion: ink-wash transitions (radial blotches that bloom and fade), text that fades up 12px, stones
that land with a quick scale 1.15 -> 1.0 and a soft ink bloom under them. Ease everything
(easeOutCubic / easeInOutSine). Nothing bounces.

## Sound

Synthesised, quiet, never busy. Master gain around 0.5.
- A low ambient pad: two detuned sine oscillators, slow low-pass swell, entering over 3s and
  leaving over 3s.
- A plucked-string motif (guqin-like: triangle or sine with a fast exponential decay, a few notes of
  a pentatonic scale, D-E-G-A-C) at each scene change.
- **A stone click every time a stone lands**: a 30ms noise burst through a band-pass around
  2.5-3.5kHz with a sharp decay, plus a tiny low thump. This is the sound people remember; make it
  crisp.
- A soft rising shimmer when the five-in-a-row is completed.
Schedule sounds from the same timeline as the visuals (compute each event's time from `t`), so
they stay in sync in both playback and record mode.

## Storyboard (times approximate; total ~70s)

1. **0-7s. Title.** Paper fades in. Ink brush circle. "Gomoku vs Jev". Subtitle: "Teaching a
   judgment model to play five-in-a-row". Seal.
2. **7-17s. What Jev is.** Three labelled boxes appear left to right and connect with ink
   lines: `state` -> `questions` -> `answers with probabilities`. One line under them:
   "Jev doesn't write text. It reads a situation and answers typed questions — with calibrated
   probabilities." Then a small 15x15 board where a probability heatmap blooms over the empty
   points, the brightest point pulsing.
3. **17-29s. Code does the rules; Jev does the judgment.** Three stacked layers slide in:
   "Rules — code (five-in-a-row, legal moves)", "Facts — code (lines, threats, what each point
   would make)", "Judgment — Jev (which move)". Caption: "Every point on the board is an option.
   Code describes the position. Jev chooses."
4. **29-41s. The lesson.** Show a board fragment with a split four `X X · X X`. First with the
   caption "What the first encoding saw: two open twos." (the gap is unmarked), then an ink stroke
   through the gap and "What was really there: a four that wins next move." Then one large line:
   "Every time Jev looked weak, the description of the board was wrong." (Forced-move accuracy: 0/12
   -> 12/12 once threats were stated as facts.)
5. **41-55s. The loop.** A circular diagram drawn as an ink ring with four stations:
   "play 20 games" -> "replay the losses" -> "fix one fact" -> "play 20 again". Two small bar pairs
   fill in beside it:
   "chose the right block of an open three: ~60% -> ~95%" and
   "took the opponent's key point when it was stated: 15% -> 56%". Caption: "No engine answers.
   Only truer facts."
6. **55-66s. A game.** A full 15x15 board. Play this black-wins sequence with a stone every
   ~0.55s, black = Jev, white = opponent, a faint heatmap flickering under each black move before it
   lands: black H8, white H9, black G7, white I9, black I7, white F7, black J8, white K9, black J7,
   white J6, black K7, white L7, black I6, white H5, black H7. Black's five is G7-H7-I7-J7-K7 on row
   7 — check that the sequence really ends in exactly that five and that no earlier five exists; fix
   the sequence if not, keeping black the winner. Draw the win line in cinnabar through the five,
   and play the shimmer.
7. **66-72s. End card.** "Still learning: long forcing sequences are beyond what the facts
   describe." Then "hanxl.com/wuziqi" large, "Play Jev" below, seal. Fade to paper, then to ink.

## Quality bar

- Text never overlaps; every caption is readable for at least 2.5s.
- Board geometry is exact: stones on intersections, 15 lines each way, star points at D4, D12,
  H8, L4, L12. Columns A-O left to right, rows 1-15 top to bottom.
- Test it: open the file in a headless browser, take screenshots at the midpoint of every scene,
  look at them, and fix anything clipped, overlapping or off-palette before finishing.
