import { z } from "zod";

/** All money is integer cents. Never floats, never model-supplied. */
export type Cents = number;

export const toCents = (usd: number): Cents => Math.round(usd * 100);
export const fromCents = (c: Cents): string => (c / 100).toFixed(2);
export const formatUSD = (c: Cents): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

/** What the LLM is allowed to produce when compiling a plain-English request. */
export const MandateDraftSchema = z.object({
  title: z.string().describe("Short name for the task, max 60 chars"),
  purpose: z.string().describe("One sentence restating the owner's goal"),
  budgetUSD: z.number().describe("Total spending ceiling in USD. 0 if the owner did not state one"),
  maxPerItemUSD: z.number().describe("Ceiling per single line item in USD. 0 if not stated"),
  allowedCategories: z.array(z.string()).describe("Catalog category slugs the agent may buy from"),
  allowedMerchants: z.array(z.string()).describe("Merchant ids the owner allowed. Empty = any verified merchant"),
  mustArriveByDays: z.number().describe("Max delivery days from now. 0 if no deadline"),
  maxUnitsPerProduct: z.number().describe("Upper bound on quantity of any one product. Use a sensible bound for the task"),
  preferences: z.array(z.string()).describe("Soft preferences the agent should weigh (not enforced)"),
  questions: z.array(z.string()).describe("Ambiguities the owner must resolve. Empty if none"),
});
export type MandateDraft = z.infer<typeof MandateDraftSchema>;

export type MandateStatus =
  | "DRAFT"
  | "AWAITING_FUNDING"
  | "ACTIVE"
  | "SHOPPING"
  | "NEEDS_APPROVAL"
  | "SETTLED"
  | "CANCELLED"
  | "EXPIRED";

/** Hard limits enforced by code. Derived from the draft and frozen at funding time. */
export interface MandateRules {
  budget: Cents;
  maxPerItem: Cents;
  allowedCategories: string[];
  allowedMerchants: string[];
  mustArriveByDays: number;
  maxUnitsPerProduct: number;
  autoApproveUnder: Cents;
  expiresAt: string; // ISO
}

export interface Mandate {
  id: string;
  /** Browser-bound owner id (see middleware). Every mandate route checks it. */
  ownerId?: string;
  title: string;
  purpose: string;
  request: string;
  rules: MandateRules;
  preferences: string[];
  status: MandateStatus;
  /** Braintree transaction id of the budget authorization hold. */
  holdId: string | null;
  authorizedAmount: Cents;
  capturedAmount: Cents;
  /** Policy-approved cart waiting for the owner's step-up approval. */
  pendingCart: PendingCart | null;
  /** Settled purchase, filled from the gateway's confirmed state. */
  order: SettledOrder | null;
  createdAt: string;
  card?: { brand?: string; last4?: string };
}

export interface PendingCart {
  lines: PricedLine[];
  total: Cents;
  rationale: string;
}

export interface SettledOrder {
  lines: PricedLine[];
  total: Cents;
  rationale: string;
  transactionId: string;
  gatewayStatus: string;
  settledAt: string;
  refunded: Cents;
}

export interface Merchant {
  id: string;
  name: string;
  verified: boolean;
  deliveryDays: number;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  category: string;
  price: Cents;
  unit: string;
  description: string;
  stock: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface PricedLine extends CartLine {
  name: string;
  merchantId: string;
  category: string;
  unitPrice: Cents;
  lineTotal: Cents;
}
