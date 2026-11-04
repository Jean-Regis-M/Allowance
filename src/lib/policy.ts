/**
 * Policy Engine: deterministic, no LLM. Every spend proposal from the agent
 * passes through here. Prices and merchants are re-read from the catalog;
 * nothing numeric from the model is trusted except product ids and quantities,
 * which are themselves bounded.
 */
import { formatUSD, type Cents, type CartLine, type Mandate, type Merchant, type PricedLine, type Product } from "./domain";

export type ViolationCode =
  | "MANDATE_NOT_ACTIVE"
  | "MANDATE_EXPIRED"
  | "EMPTY_CART"
  | "UNKNOWN_PRODUCT"
  | "INVALID_QUANTITY"
  | "QUANTITY_LIMIT"
  | "OUT_OF_STOCK"
  | "CATEGORY_NOT_ALLOWED"
  | "MERCHANT_NOT_ALLOWED"
  | "MERCHANT_UNVERIFIED"
  | "DELIVERY_TOO_SLOW"
  | "ITEM_OVER_LIMIT"
  | "OVER_BUDGET"
  | "DUPLICATE_LINE";

export interface Violation {
  code: ViolationCode;
  message: string;
  productId?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  violations: Violation[];
  lines: PricedLine[];
  total: Cents;
  /** True when allowed but total is above the owner's auto-approve threshold. */
  requiresHumanApproval: boolean;
}

export interface CatalogView {
  product(id: string): Product | undefined;
  merchant(id: string): Merchant | undefined;
}

const SPENDABLE = new Set(["ACTIVE", "SHOPPING", "NEEDS_APPROVAL"]);

export function evaluateCart(
  mandate: Mandate,
  cart: CartLine[],
  catalog: CatalogView,
  now: Date = new Date(),
): PolicyDecision {
  const v: Violation[] = [];
  const lines: PricedLine[] = [];
  const r = mandate.rules;

  if (!SPENDABLE.has(mandate.status)) {
    v.push({ code: "MANDATE_NOT_ACTIVE", message: `Mandate is ${mandate.status}; spending is not permitted.` });
  }
  if (now.getTime() > Date.parse(r.expiresAt)) {
    v.push({ code: "MANDATE_EXPIRED", message: "Mandate has expired." });
  }
  if (cart.length === 0) {
    v.push({ code: "EMPTY_CART", message: "Cart is empty." });
  }

  const seen = new Set<string>();
  for (const line of cart) {
    const p = catalog.product(line.productId);
    if (!p) {
      v.push({ code: "UNKNOWN_PRODUCT", message: `Product ${line.productId} does not exist.`, productId: line.productId });
      continue;
    }
    if (seen.has(p.id)) {
      v.push({ code: "DUPLICATE_LINE", message: `${p.name} appears twice; merge quantities.`, productId: p.id });
    }
    seen.add(p.id);

    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      v.push({ code: "INVALID_QUANTITY", message: `Quantity for ${p.name} must be a positive integer.`, productId: p.id });
      continue;
    }
    if (line.quantity > r.maxUnitsPerProduct) {
      v.push({
        code: "QUANTITY_LIMIT",
        message: `${line.quantity} × ${p.name} exceeds the mandate limit of ${r.maxUnitsPerProduct} units per product.`,
        productId: p.id,
      });
    }
    if (line.quantity > p.stock) {
      v.push({ code: "OUT_OF_STOCK", message: `Only ${p.stock} of ${p.name} in stock.`, productId: p.id });
    }
    if (r.allowedCategories.length > 0 && !r.allowedCategories.includes(p.category)) {
      v.push({ code: "CATEGORY_NOT_ALLOWED", message: `Category "${p.category}" is outside this mandate.`, productId: p.id });
    }
    const m = catalog.merchant(p.merchantId);
    if (!m || !m.verified) {
      v.push({ code: "MERCHANT_UNVERIFIED", message: `${m?.name ?? "This merchant"} is not a verified merchant.`, productId: p.id });
    } else {
      if (r.allowedMerchants.length > 0 && !r.allowedMerchants.includes(m.id)) {
        v.push({ code: "MERCHANT_NOT_ALLOWED", message: `${m.name} is not on the owner's supplier list.`, productId: p.id });
      }
      if (r.mustArriveByDays > 0 && m.deliveryDays > r.mustArriveByDays) {
        v.push({
          code: "DELIVERY_TOO_SLOW",
          message: `${m.name} delivers in ${m.deliveryDays} days; deadline is ${r.mustArriveByDays}.`,
          productId: p.id,
        });
      }
    }
    const lineTotal = p.price * line.quantity;
    if (r.maxPerItem > 0 && lineTotal > r.maxPerItem) {
      v.push({ code: "ITEM_OVER_LIMIT", message: `${p.name}: ${formatUSD(lineTotal)} exceeds the per-item limit of ${formatUSD(r.maxPerItem)}.`, productId: p.id });
    }
    lines.push({
      productId: p.id,
      quantity: line.quantity,
      name: p.name,
      merchantId: p.merchantId,
      category: p.category,
      unitPrice: p.price,
      lineTotal,
    });
  }

  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  const ceiling = Math.min(r.budget, mandate.authorizedAmount - mandate.capturedAmount);
  if (total > ceiling) {
    v.push({ code: "OVER_BUDGET", message: `Cart total ${formatUSD(total)} exceeds the remaining allowance of ${formatUSD(ceiling)}.` });
  }

  const allowed = v.length === 0;
  return {
    allowed,
    violations: v,
    lines,
    total,
    requiresHumanApproval: allowed && total > r.autoApproveUnder,
  };
}
