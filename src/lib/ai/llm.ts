/**
 * Google Gemini access layer. Server-side only.
 * - One shared client, key from GEMINI_API_KEY.
 * - Retries with exponential backoff on rate limits / transient errors (free tier friendly).
 * - A narrow ChatModel interface so the agent loop is provider-agnostic and testable.
 */
import { GoogleGenAI, ApiError, type Content, type FunctionDeclaration } from "@google/genai";

/** Preferred model first, then fallbacks used when a model is overloaded (503) or rate-limited (429). */
export const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let lastGood: string | null = null;

/** Circuit breaker: a model that was overloaded/rate-limited is skipped for a while. */
const COOLDOWN_MS = 120_000;
const cooling = new Map<string, number>();

/** Ordered, de-duplicated model chain; the last model that worked goes first, cooling models last. */
export function modelChain(): string[] {
  const all = Array.from(new Set([...(lastGood ? [lastGood] : []), MODEL, ...FALLBACKS]));
  const now = Date.now();
  const hot = all.filter((m) => (cooling.get(m) ?? 0) <= now);
  const cold = all.filter((m) => (cooling.get(m) ?? 0) > now);
  return [...hot, ...cold];
}

/** The model that served the most recent successful call (for UI / ledger transparency). */
export const activeModel = () => lastGood ?? MODEL;

/**
 * Run `op(model)` across the model chain. Overload / rate-limit / server errors move on to the
 * next model immediately; after a full pass fails, wait and try the whole chain again.
 */
export async function withModelFallback<T>(op: (model: string) => Promise<T>, rounds = 3): Promise<T> {
  let lastErr: unknown;
  for (let round = 0; round < rounds; round++) {
    for (const model of modelChain()) {
      try {
        const out = await op(model);
        lastGood = model;
        return out;
      } catch (e) {
        lastErr = e;
        const status = e instanceof ApiError ? e.status : undefined;
        // 404 = model not offered to this key; transient codes = try the next model
        if (status !== undefined && status !== 404 && !RETRYABLE.has(status)) throw e;
        cooling.set(model, Date.now() + (status === 404 ? 24 * 3_600_000 : COOLDOWN_MS));
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (round + 1)));
  }
  throw lastErr;
}

let client: GoogleGenAI | null = null;
export function genai(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured (see .env.example)");
  client = new GoogleGenAI({ apiKey });
  return client;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function withRetry<T>(op: () => Promise<T>, attempts = 4): Promise<T> {
  let delay = 1500;
  for (let i = 1; ; i++) {
    try {
      return await op();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      if (i >= attempts || (status !== undefined && !RETRYABLE.has(status))) throw e;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 400));
      delay *= 2;
    }
  }
}

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelTurn {
  text: string;
  calls: ToolCall[];
  /** The model's content exactly as returned (keeps thought signatures intact). */
  raw: Content;
  blocked?: string;
}

export type ChatModel = (history: Content[]) => Promise<ModelTurn>;

export function geminiChatModel(systemInstruction: string, tools: FunctionDeclaration[]): ChatModel {
  return async (history) => {
    const res = await withModelFallback((model) =>
      genai().models.generateContent({
        model,
        contents: history,
        config: { systemInstruction, tools: [{ functionDeclarations: tools }], temperature: 0.2, maxOutputTokens: 4096 },
      }),
    );
    const cand = res.candidates?.[0];
    const blocked = res.promptFeedback?.blockReason ?? (cand?.finishReason === "SAFETY" ? "SAFETY" : undefined);
    const raw: Content = cand?.content ?? { role: "model", parts: [] };
    const text = (raw.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    const calls: ToolCall[] = (res.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> }));
    return { text, calls, raw: { role: "model", parts: raw.parts ?? [] }, blocked: blocked ? String(blocked) : undefined };
  };
}
