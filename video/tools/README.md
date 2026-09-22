# Video tools

- `record-game.mts` — records a game on the live page with Playwright. White is driven by
  `lib/opponent.ts` at the given level (clicking the real UI); Jev plays black through `/api/move`.
  Writes `out/game-L<level>-seed<seed>.webm` plus `.events.json` (when each stone landed).
  `npx tsx record-game.mts https://hanxl.com/wuziqi 7 3` (needs `playwright` installed next to it).
- `sfx.mjs` — builds the stone-click + win-shimmer WAV from `.events.json`:
  `node sfx.mjs game.events.json <duration> sfx.wav`, then mux with ffmpeg.
- `narration.tsv` — scene start, scene end, line. Voiced with Edge TTS
  (`uvx edge-tts --voice en-US-AndrewNeural`), each line placed 0.6s into its scene
  (1.2s for the title), music ducked under it with `sidechaincompress`.

`../intro.html?record=1` records the canvas intro itself (headless Chromium with
`--autoplay-policy=no-user-gesture-required`; the result is at `window.__videoBlobUrl`).
