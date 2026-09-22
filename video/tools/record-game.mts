// Record a game on the real page: the human side (white) is driven by the L2
// opponent from lib/opponent.ts, clicking the UI like a person would; Jev
// plays black through the real /api/move. Output: game.webm in ./out.
//   npx tsx record-game.ts <url> <seed>
import { chromium } from "playwright";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { makeRng, opponentMove } from "/Users/chrishan/Dev/playground/wuziqi/lib/opponent";
import type { Board, Player } from "/Users/chrishan/Dev/playground/wuziqi/lib/board";

const URL = process.argv[2] ?? "http://localhost:3001/wuziqi";
const SEED = Number(process.argv[3] ?? 7);
const LEVEL = Number(process.argv[4] ?? 3) as 0 | 1 | 2 | 3;
const N = 15;
const W = 1440, H = 810;
mkdirSync("out", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: "out/raw", size: { width: W, height: H } } });
// Headless video has no pointer; draw one so the human's moves read as moves.
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(236,224,200,.95);box-shadow:0 0 0 1.5px rgba(40,28,16,.75),0 2px 6px rgba(0,0,0,.35);pointer-events:none;z-index:99999;transition:transform .12s ease";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; });
    addEventListener("mousedown", () => { c.style.transform = "scale(.75)"; });
    addEventListener("mouseup", () => { c.style.transform = "scale(1)"; });
    // Every stone that lands on the board, for the sound track.
    (window as any).__stoneEvents = [];
    const seen = new WeakSet();
    new MutationObserver(() => {
      document.querySelectorAll(".grid .pt .stone").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        (window as any).__stoneEvents.push({ t: Date.now(), p: Number((el as HTMLElement).dataset.p) });
      });
      const v = document.querySelector(".verdict");
      if (v && !(window as any).__endAt) (window as any).__endAt = Date.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
});
const page = await ctx.newPage();
const t0 = Date.now(); // the video starts with the page
await page.goto(URL, { waitUntil: "networkidle" });
await page.mouse.move(W * 0.72, H * 0.6);

const readBoard = () => page.evaluate(() => {
  const pts = [...document.querySelectorAll(".grid .pt")];
  return pts.map((p) => Number((p.querySelector(".stone:not(.hand-stone)") as HTMLElement | null)?.dataset.p ?? 0));
});
const idle = () => page.waitForFunction(() => !document.querySelector('.turn-dot[data-w="think"]') && !document.querySelector(".hand"), null, { timeout: 60000 });
const ended = () => page.evaluate(() => !!document.querySelector(".verdict"));

// Jev (black) opens by itself.
await page.waitForFunction(() => document.querySelectorAll(".grid .stone").length >= 1, null, { timeout: 60000 });
await idle();
const rng = makeRng(SEED);
let moves = 0;
while (!(await ended()) && moves < 110) {
  const board = (await readBoard()) as Board;
  const idx = opponentMove(board, N, 2 as Player, LEVEL, rng);
  const el = page.locator(".grid .pt").nth(idx);
  const box = (await el.boundingBox())!;
  await page.waitForTimeout(500 + Math.floor(rng() * 700)); // a human looks before moving
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(250);
  await page.mouse.down(); await page.mouse.up();
  moves++;
  await page.waitForTimeout(300);
  if (await ended()) break;
  await page.waitForFunction((n) => document.querySelectorAll(".grid .pt .stone").length >= n, (board.filter((v) => v).length + 2), { timeout: 60000 }).catch(() => {});
  await idle();
  await page.mouse.move(W * 0.72 + rng() * 60, H * 0.62 + rng() * 40, { steps: 14 });
}
await page.waitForTimeout(4500); // hold on the result
const verdict = await page.evaluate(() => document.querySelector(".verdict")?.textContent ?? "");
const meta = await page.evaluate(() => document.querySelector(".status-head .meta")?.textContent ?? "");
const stones = await page.evaluate(() => (window as any).__stoneEvents as Array<{ t: number; p: number }>);
const endAt = await page.evaluate(() => (window as any).__endAt as number | undefined);
const vpath = await page.video()!.path();
await ctx.close();
await browser.close();
const out = `out/game-L${LEVEL}-seed${SEED}.webm`;
renameSync(vpath, out);
writeFileSync(out.replace(".webm", ".events.json"), JSON.stringify({
  stones: stones.map((e) => ({ t: (e.t - t0) / 1000, p: e.p })),
  end: endAt ? (endAt - t0) / 1000 : null,
  verdict: "",
}));
console.log(JSON.stringify({ seed: SEED, level: LEVEL, verdict, meta, whiteMoves: moves, stones: stones.length, video: out }));
