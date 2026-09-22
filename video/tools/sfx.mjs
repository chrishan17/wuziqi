// Build a WAV sound track for a recorded game from its stone events.
//   node sfx.mjs <events.json> <duration-seconds> <out.wav>
import { readFileSync, writeFileSync } from "node:fs";
const [ev, durS, out] = process.argv.slice(2);
const { stones, end } = JSON.parse(readFileSync(ev, "utf8"));
const SR = 48000, dur = Number(durS);
const L = new Float32Array(Math.ceil(dur * SR)), R = new Float32Array(L.length);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

// One stone on kaya wood: a bright band-passed tick, a hollow knock, a short body.
function click(t, pitch, gain, pan) {
  const n = Math.floor(0.25 * SR), start = Math.floor(t * SR);
  // biquad band-pass around 3kHz
  const f0 = 3000 * pitch, Q = 1.4, w = 2 * Math.PI * f0 / SR, al = Math.sin(w) / (2 * Q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const x = rnd() * Math.exp(-s / 0.004);
    // direct form I: y[n] = (b0 x[n] + b2 x[n-2] - a1 y[n-1] - a2 y[n-2]) / a0
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const tick = y * 2.2;
    const knock = Math.sin(2 * Math.PI * 210 * pitch * s) * Math.exp(-s / 0.028) * 0.55
                + Math.sin(2 * Math.PI * 1150 * pitch * s) * Math.exp(-s / 0.009) * 0.35;
    const body = Math.sin(2 * Math.PI * 95 * s) * Math.exp(-s / 0.05) * 0.25;
    const v = (tick + knock + body) * gain;
    const k = start + i; if (k >= L.length) break;
    L[k] += v * (1 - pan * 0.3); R[k] += v * (1 + pan * 0.3);
  }
}
// Rising pentatonic shimmer for the five.
function shimmer(t) {
  const notes = [587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
  notes.forEach((f, j) => {
    const st = Math.floor((t + j * 0.11) * SR), n = Math.floor(2.4 * SR);
    for (let i = 0; i < n; i++) {
      const s = i / SR, k = st + i; if (k >= L.length) break;
      const env = Math.min(1, s / 0.01) * Math.exp(-s / 0.9);
      const v = (Math.sin(2 * Math.PI * f * s) + 0.3 * Math.sin(2 * Math.PI * f * 2 * s)) * env * 0.075;
      L[k] += v * (j % 2 ? 0.8 : 1.1); R[k] += v * (j % 2 ? 1.1 : 0.8);
    }
  });
}
stones.forEach((e, i) => click(e.t, e.p === 2 ? 1.08 : 1.0, 0.5 + (i % 3) * 0.03, e.p === 2 ? 0.25 : -0.25));
if (end) shimmer(end + 0.15);

// normalise to -1 dBFS peak, write 16-bit stereo WAV
let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak ? 0.89 / peak : 1;
const buf = Buffer.alloc(44 + L.length * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + L.length * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(L.length * 4, 40);
for (let i = 0; i < L.length; i++) {
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * g * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * g * 32767))), 46 + i * 4);
}
writeFileSync(out, buf);
console.log({ stones: stones.length, end, peakBeforeNorm: peak.toFixed(3) });
