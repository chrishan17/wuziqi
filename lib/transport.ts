// Two ways to reach Jev. Same questions, same normalised answers.
//
//   gateway (default) — Vercel AI Gateway via the AI SDK. Needs AI_GATEWAY_API_KEY
//                       and a payment method on the Vercel account.
//   native            — TypeSafe's own API via plain fetch. Needs TYPESAFE_API_KEY.
//
// The two differ in the yes/no primitive: the AI SDK calls it `boolean` and returns
// `probability`; TypeSafe natively calls it `noul` and returns `noul`. Everything
// else lines up. This module hides that difference so lib/jev.ts asks once.

import { experimental_evaluate as evaluate } from "ai";

export type Question =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown | null> }
  | { type: "score"; instructions: unknown; criteria: unknown[] }
  | { type: "boolean"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } };

export type Answer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> }
  | { type: "boolean"; probability: number };

export type JevResult = {
  answers: Record<string, Answer>;
  usage?: { inputTokens?: number; outputTokens?: number };
  warnings: unknown[];
  transport: "gateway" | "native";
};

export type Transport = "gateway" | "native";

/**
 * Warnings about an ambiguous or malformed transport setup. Callers surface
 * these; picking silently is how you end up debugging the wrong provider.
 */
export function transportWarnings(): string[] {
  const out: string[] = [];
  const explicit = process.env.JEV_TRANSPORT;
  const hasGateway = !!process.env.AI_GATEWAY_API_KEY;
  const hasNative = !!process.env.TYPESAFE_API_KEY;

  if (explicit && explicit !== "gateway" && explicit !== "native") {
    out.push(`JEV_TRANSPORT="${explicit}" is not a transport; expected "gateway" or "native".`);
  }
  if (!explicit && hasGateway && hasNative) {
    out.push(
      'Both AI_GATEWAY_API_KEY and TYPESAFE_API_KEY are set and JEV_TRANSPORT is not. ' +
        'Defaulting to "gateway" — set JEV_TRANSPORT explicitly to choose.',
    );
  }
  if (explicit === "native" && !hasNative && hasGateway) {
    out.push('JEV_TRANSPORT=native but TYPESAFE_API_KEY is empty; the gateway key will not be used.');
  }
  if (explicit === "gateway" && !hasGateway && hasNative) {
    out.push('JEV_TRANSPORT=gateway but AI_GATEWAY_API_KEY is empty; the TypeSafe key will not be used.');
  }
  return out;
}

export function activeTransport(): Transport {
  const explicit = process.env.JEV_TRANSPORT as Transport | undefined;
  if (explicit === "gateway" || explicit === "native") return explicit;
  if (process.env.AI_GATEWAY_API_KEY) return "gateway";
  if (process.env.TYPESAFE_API_KEY) return "native";
  return "gateway";
}

export function describeMissingKey(t: Transport): string | null {
  if (t === "gateway" && !process.env.AI_GATEWAY_API_KEY) {
    return "AI_GATEWAY_API_KEY is not set (get one at https://vercel.com/ai-gateway).";
  }
  if (t === "native" && !process.env.TYPESAFE_API_KEY) {
    return "TYPESAFE_API_KEY is not set (get one at https://typesafe.ai).";
  }
  return null;
}

/**
 * Retry on the two statuses the API documents as transient, plus outright
 * network failures. AGENTS.md has called for this from the start and it was
 * never implemented; at one request per move nobody noticed, but a measurement
 * run makes hundreds in a row and a single 429 there does not just fail — the
 * harness scores the errored game as a loss, so a transient blip becomes a data
 * point. 401/422 are not retried: a bad key or a malformed question set will
 * fail identically forever.
 */
const RETRY_DELAYS_MS = [500, 1500, 4000];

function isTransient(err: unknown): boolean {
  const m = String((err as any)?.message ?? err);
  if (/\b(429|529|500|502|503|504)\b/.test(m)) return true;
  // fetch() rejects with a TypeError on DNS/connection failures.
  return /fetch failed|ECONNRESET|ETIMEDOUT|network|socket hang up/i.test(m);
}

export async function callJev(opts: {
  state: unknown;
  questions: Record<string, Question>;
  signal?: AbortSignal;
}): Promise<JevResult> {
  const transport = activeTransport();
  const missing = describeMissingKey(transport);
  if (missing) throw new Error(missing);
  const run = () => (transport === "native" ? callNative(opts) : callGateway(opts));

  let last: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await run();
    } catch (err) {
      last = err;
      if (opts.signal?.aborted || attempt === RETRY_DELAYS_MS.length || !isTransient(err)) break;
      // Jitter so parallel callers do not all come back at the same instant.
      const wait = RETRY_DELAYS_MS[attempt] * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function callGateway(opts: {
  state: unknown;
  questions: Record<string, Question>;
  signal?: AbortSignal;
}): Promise<JevResult> {
  const result = await evaluate({
    model: process.env.JEV_MODEL ?? "typesafe-ai/jev",
    state: opts.state as any,
    questions: opts.questions as any,
    abortSignal: opts.signal,
  });
  return {
    answers: result.answers as unknown as Record<string, Answer>,
    usage: result.usage,
    warnings: (result.warnings ?? []) as unknown[],
    transport: "gateway",
  };
}

async function callNative(opts: {
  state: unknown;
  questions: Record<string, Question>;
  signal?: AbortSignal;
}): Promise<JevResult> {
  // `boolean` -> `noul` on the way out.
  const questions: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(opts.questions)) {
    questions[id] = q.type === "boolean" ? { ...q, type: "noul" } : q;
  }

  const base = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: opts.state,
      model: process.env.JEV_NATIVE_MODEL ?? "jev-latest",
      questions,
    }),
    signal: opts.signal,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`TypeSafe API ${res.status}: ${text.slice(0, 500)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`TypeSafe API returned non-JSON: ${text.slice(0, 200)}`);
  }

  // `noul` -> `boolean` on the way back.
  const answers: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(parsed.answers ?? {}) as [string, any][]) {
    answers[id] = a.type === "noul" ? { type: "boolean", probability: a.noul } : a;
  }

  return {
    answers,
    usage: {
      inputTokens: parsed.usage?.input_tokens,
      outputTokens: parsed.usage?.output_tokens,
    },
    warnings: [],
    transport: "native",
  };
}
