/** Mandate Compiler: plain English → structured, reviewable spending rules (Gemini structured output). */
import { z } from "zod";
import { MandateDraftSchema, type MandateDraft } from "../domain";
import { CATEGORIES, MERCHANTS } from "../catalog-seed";
import { genai, withModelFallback } from "./llm";

const SYSTEM = `You convert a small-business owner's purchasing request into a spending mandate for an AI purchasing agent.
Rules:
- Only use category slugs from this list: ${CATEGORIES.join(", ")}.
- Only use merchant ids from this list (name → id): ${MERCHANTS.map((m) => `${m.name} → ${m.id}`).join("; ")}.
- If the owner names "usual suppliers" or specific suppliers, map them to merchant ids; if you cannot map them, leave allowedMerchants empty and add a question.
- Never invent a budget. If no budget is stated, set budgetUSD to 0 and add a question asking for one.
- Choose the narrowest categories that satisfy the request. Do not include categories the owner did not ask for.
- maxUnitsPerProduct must be a sensible small bound for the request (e.g. a weekly café restock rarely needs more than 6 of any case or pack).
- Deadlines are hard limits, not preferences: if the owner gives a deadline ("by Friday", "within 3 days", a date), set mustArriveByDays to the whole number of days from today until that deadline (use the date given in the request context). Never put a deadline only in preferences.
- Questions are only for genuine ambiguity that changes what may be bought.`;

const JSON_SCHEMA = z.toJSONSchema(MandateDraftSchema);

/** e.g. "Wednesday, 4 November 2026" — lets the model turn "by Friday" into a number of days. */
const today = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export async function compileMandate(request: string, context = "The owner's usual suppliers are Greenleaf Dairy Alternatives and PackRight Supplies."): Promise<MandateDraft> {
  const res = await withModelFallback((model) =>
    genai().models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `Today is ${today()}.\nBusiness context: ${context}\n\nRequest: ${request}` }] }],
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: JSON_SCHEMA, temperature: 0 },
    }),
  );
  if (res.promptFeedback?.blockReason) throw new Error(`Request blocked by model safety filter: ${res.promptFeedback.blockReason}`);
  const text = res.text;
  if (!text) throw new Error("Mandate compiler returned no output.");
  const parsed = MandateDraftSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Mandate compiler output failed validation: ${parsed.error.message.slice(0, 300)}`);
  return sanitizeDraft(parsed.data);
}

/** Defence in depth: drop anything the model produced that is not in the real catalog. */
export function sanitizeDraft(d: MandateDraft): MandateDraft {
  const merchantIds = new Set(MERCHANTS.map((m) => m.id));
  return {
    ...d,
    title: d.title.slice(0, 60),
    budgetUSD: Math.max(0, Math.round(d.budgetUSD * 100) / 100),
    maxPerItemUSD: Math.max(0, Math.round(d.maxPerItemUSD * 100) / 100),
    allowedCategories: d.allowedCategories.filter((c) => CATEGORIES.includes(c)),
    allowedMerchants: d.allowedMerchants.filter((m) => merchantIds.has(m)),
    mustArriveByDays: Math.max(0, Math.floor(d.mustArriveByDays)),
    maxUnitsPerProduct: Math.min(50, Math.max(1, Math.floor(d.maxUnitsPerProduct))),
  };
}
