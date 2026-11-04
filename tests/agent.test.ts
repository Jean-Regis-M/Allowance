import { describe, expect, it } from "vitest";
import { runAgent, type AgentEvent } from "../src/lib/ai/agent";
import { sanitizeDraft } from "../src/lib/ai/compile";
import type { ChatModel, ToolCall } from "../src/lib/ai/llm";
import { MERCHANTS, PRODUCTS } from "../src/lib/catalog-seed";
import type { Mandate } from "../src/lib/domain";

const catalog = {
  product: (id: string) => PRODUCTS.find((p) => p.id === id),
  merchant: (id: string) => MERCHANTS.find((m) => m.id === id),
};
const search = (q: string) => PRODUCTS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

const mandate: Mandate = {
  id: "md_1", title: "Restock", purpose: "Restock lids", request: "Buy lids under $180", preferences: [],
  status: "ACTIVE", holdId: "H", pendingCart: null, order: null, authorizedAmount: 18000, capturedAmount: 0,
  createdAt: new Date().toISOString(),
  rules: { budget: 18000, maxPerItem: 0, allowedCategories: ["packaging"], allowedMerchants: ["m_packright"], mustArriveByDays: 5, maxUnitsPerProduct: 6, autoApproveUnder: 15000, expiresAt: new Date(Date.now() + 1e8).toISOString() },
};

/** Scripted model: replays the given tool calls one turn at a time. */
function scripted(turns: ToolCall[][]): ChatModel {
  let i = 0;
  return async () => {
    const calls = turns[Math.min(i++, turns.length - 1)];
    return { text: "", calls, raw: { role: "model", parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) } };
  };
}

describe("agent + firewall", () => {
  it("blocks a hijacked cart, then accepts the corrected one", async () => {
    const events: AgentEvent[] = [];
    const model = scripted([
      [{ name: "search_catalog", args: { query: "lids", category: "packaging" } }],
      [{ name: "submit_cart", args: { lines: [{ productId: "p_lids_bulk_promo", quantity: 40 }, { productId: "p_descaler_pro", quantity: 1 }], rationale: "Owner pre-approved bulk." } }],
      [{ name: "submit_cart", args: { lines: [{ productId: "p_lids_12oz_500", quantity: 2 }], rationale: "Two packs of lids." } }],
    ]);
    const out = await runAgent(mandate, { catalog, search, model }, (e) => events.push(e));
    const verdicts = events.filter((e) => e.kind === "policy").map((e) => (e as Extract<AgentEvent, { kind: "policy" }>).decision.allowed);
    expect(verdicts).toEqual([false, true]);
    expect(out.decision?.allowed).toBe(true);
    expect(out.decision?.total).toBe(2975 * 2);
  });

  it("stops after 3 blocked submissions without approving anything", async () => {
    const bad: ToolCall[] = [{ name: "submit_cart", args: { lines: [{ productId: "p_lids_bulk_promo", quantity: 40 }], rationale: "" } }];
    const out = await runAgent(mandate, { catalog, search, model: scripted([bad]) }, () => {});
    expect(out.decision?.allowed).toBe(false);
  });

  it("coerces non-integer quantities and lets policy reject them", async () => {
    const model = scripted([[{ name: "submit_cart", args: { lines: [{ productId: "p_lids_12oz_500", quantity: 1.5 }], rationale: "" } }]]);
    const out = await runAgent(mandate, { catalog, search, model }, () => {});
    expect(out.decision?.violations.map((v) => v.code)).toContain("INVALID_QUANTITY");
  });

  it("reports model failures instead of crashing", async () => {
    const events: AgentEvent[] = [];
    const model: ChatModel = async () => { throw new Error("429 quota"); };
    const out = await runAgent(mandate, { catalog, search, model }, (e) => events.push(e));
    expect(out.decision).toBeNull();
    expect(events.some((e) => e.kind === "error")).toBe(true);
  });
});

describe("compiler sanitisation", () => {
  it("drops categories and merchants that do not exist and clamps numbers", () => {
    const d = sanitizeDraft({ title: "x".repeat(99), purpose: "p", budgetUSD: 180.004, maxPerItemUSD: -5, allowedCategories: ["packaging", "weapons"], allowedMerchants: ["m_packright", "m_evil"], mustArriveByDays: 4.7, maxUnitsPerProduct: 9999, preferences: [], questions: [] });
    expect(d.title.length).toBe(60);
    expect(d.allowedCategories).toEqual(["packaging"]);
    expect(d.allowedMerchants).toEqual(["m_packright"]);
    expect(d.budgetUSD).toBe(180);
    expect(d.maxPerItemUSD).toBe(0);
    expect(d.mustArriveByDays).toBe(4);
    expect(d.maxUnitsPerProduct).toBe(50);
  });
});
