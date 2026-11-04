import { describe, expect, it } from "vitest";
import { evaluateCart, type CatalogView } from "../src/lib/policy";
import { MERCHANTS, PRODUCTS } from "../src/lib/catalog-seed";
import type { Mandate } from "../src/lib/domain";
import { GENESIS, hashEntry, verifyChain, type LedgerEntry } from "../src/lib/ledger";

const catalog: CatalogView = {
  product: (id) => PRODUCTS.find((p) => p.id === id),
  merchant: (id) => MERCHANTS.find((m) => m.id === id),
};

function mandate(over: Partial<Mandate["rules"]> = {}, status: Mandate["status"] = "ACTIVE"): Mandate {
  return {
    id: "md_test",
    title: "Weekly restock",
    purpose: "Restock oat milk, cups and lids",
    request: "",
    preferences: [],
    status,
    holdId: "HOLD", pendingCart: null, order: null,
    
    authorizedAmount: 18000,
    capturedAmount: 0,
    createdAt: new Date().toISOString(),
    rules: {
      budget: 18000,
      maxPerItem: 0,
      allowedCategories: ["dairy-alternatives", "packaging"],
      allowedMerchants: ["m_greenleaf", "m_packright"],
      mustArriveByDays: 5,
      maxUnitsPerProduct: 6,
      autoApproveUnder: 15000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ...over,
    },
  };
}

describe("policy engine", () => {
  it("allows a compliant cart and prices it from the catalog", () => {
    const d = evaluateCart(mandate(), [
      { productId: "p_oat_barista_6", quantity: 3 },
      { productId: "p_cups_12oz_500", quantity: 1 },
      { productId: "p_lids_12oz_500", quantity: 1 },
    ], catalog);
    expect(d.violations).toEqual([]);
    expect(d.allowed).toBe(true);
    expect(d.total).toBe(2149 * 3 + 4650 + 2975);
    expect(d.requiresHumanApproval).toBe(false);
  });

  it("blocks the prompt-injection cart (quantity + category + budget)", () => {
    const d = evaluateCart(mandate(), [
      { productId: "p_lids_bulk_promo", quantity: 40 },
      { productId: "p_descaler_pro", quantity: 1 },
    ], catalog);
    const codes = d.violations.map((v) => v.code);
    expect(d.allowed).toBe(false);
    expect(codes).toContain("QUANTITY_LIMIT");
    expect(codes).toContain("CATEGORY_NOT_ALLOWED");
    expect(codes).toContain("MERCHANT_NOT_ALLOWED");
    expect(codes).toContain("OVER_BUDGET");
  });

  it("blocks unverified merchants and slow delivery", () => {
    const d = evaluateCart(mandate({ allowedMerchants: [] }), [
      { productId: "p_cups_dealz", quantity: 1 },
      { productId: "p_oat_slow_12", quantity: 1 },
    ], catalog);
    const codes = d.violations.map((v) => v.code);
    expect(codes).toContain("MERCHANT_UNVERIFIED");
    expect(codes).toContain("DELIVERY_TOO_SLOW");
  });

  it("rejects unknown products, bad quantities and duplicates", () => {
    const d = evaluateCart(mandate(), [
      { productId: "p_nope", quantity: 1 },
      { productId: "p_oat_barista_6", quantity: 1.5 },
      { productId: "p_cups_12oz_500", quantity: 1 },
      { productId: "p_cups_12oz_500", quantity: 1 },
    ], catalog);
    const codes = d.violations.map((v) => v.code);
    expect(codes).toEqual(expect.arrayContaining(["UNKNOWN_PRODUCT", "INVALID_QUANTITY", "DUPLICATE_LINE"]));
  });

  it("caps spend at the remaining PayPal authorization, not just the budget", () => {
    const m = mandate();
    m.capturedAmount = 12000;
    const d = evaluateCart(m, [{ productId: "p_cups_12oz_500", quantity: 2 }], catalog);
    expect(d.violations.map((v) => v.code)).toContain("OVER_BUDGET");
  });

  it("refuses to spend from a mandate that PayPal has not funded", () => {
    const d = evaluateCart(mandate({}, "AWAITING_FUNDING"), [{ productId: "p_almond_6", quantity: 1 }], catalog);
    expect(d.violations.map((v) => v.code)).toContain("MANDATE_NOT_ACTIVE");
  });

  it("rejects expired mandates", () => {
    const d = evaluateCart(mandate({ expiresAt: new Date(Date.now() - 1000).toISOString() }), [{ productId: "p_almond_6", quantity: 1 }], catalog);
    expect(d.violations.map((v) => v.code)).toContain("MANDATE_EXPIRED");
  });

  it("requests human step-up above the auto-approve threshold", () => {
    const d = evaluateCart(mandate({ autoApproveUnder: 5000 }), [{ productId: "p_cups_12oz_500", quantity: 2 }], catalog);
    expect(d.allowed).toBe(true);
    expect(d.requiresHumanApproval).toBe(true);
  });
});

describe("ledger hash chain", () => {
  function build(n: number): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    let prev = GENESIS;
    for (let i = 1; i <= n; i++) {
      const base = { seq: i, mandateId: "md", at: `2026-11-0${i}T00:00:00Z`, actor: "system" as const, type: "t", summary: `e${i}`, data: { i, nested: { b: 2, a: 1 } }, prevHash: prev };
      const e = { ...base, hash: hashEntry(base) };
      out.push(e);
      prev = e.hash;
    }
    return out;
  }
  it("verifies an intact chain", () => {
    expect(verifyChain(build(4))).toEqual({ ok: true });
  });
  it("detects tampering", () => {
    const chain = build(4);
    chain[1] = { ...chain[1], summary: "edited" };
    expect(verifyChain(chain)).toEqual({ ok: false, brokenAt: 2 });
  });
});
