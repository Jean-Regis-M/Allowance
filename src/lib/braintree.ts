/**
 * PayPal Braintree payment service (sandbox by default). Server-side only.
 *
 * Mandate model on Braintree:
 *   1. holdBudget()      transaction.sale WITHOUT submitForSettlement -> status "authorized".
 *                        The authorization hold IS the agent's spending ceiling.
 *   2. settleExact()     submitForSettlement(id, amount) with amount <= authorized, computed
 *                        by the Policy Engine. Braintree releases the unused remainder.
 *   3. releaseHold()     void() when the mandate is cancelled or the agent buys nothing.
 *   4. refund()          refund(id, amount) after settlement, owner-approved.
 * Every status shown in the UI is re-read from Braintree (findTransaction), never assumed.
 */
import braintree from "braintree";
import { fromCents, toCents, type Cents } from "./domain";

let gw: braintree.BraintreeGateway | null = null;

export function gateway(): braintree.BraintreeGateway {
  if (gw) return gw;
  const { BRAINTREE_MERCHANT_ID: merchantId, BRAINTREE_PUBLIC_KEY: publicKey, BRAINTREE_PRIVATE_KEY: privateKey } = process.env;
  if (!merchantId || !publicKey || !privateKey) throw new Error("Braintree sandbox keys are not configured (see .env.example)");
  const env = process.env.BRAINTREE_ENVIRONMENT === "production" ? braintree.Environment.Production : braintree.Environment.Sandbox;
  gw = new braintree.BraintreeGateway({ environment: env, merchantId, publicKey, privateKey });
  return gw;
}

export const isSandbox = () => process.env.BRAINTREE_ENVIRONMENT !== "production";

export class PaymentError extends Error {
  constructor(public op: string, message: string, public processorCode?: string) {
    super(`Braintree ${op} failed: ${message}`);
  }
}

export interface TxnView {
  id: string;
  status: string;
  amount: Cents;
  orderId?: string;
  paymentInstrument: string;
  last4?: string;
  cardType?: string;
  processorResponse?: string;
  updatedAt: string;
}

function view(t: braintree.Transaction): TxnView {
  return {
    id: t.id,
    status: t.status,
    amount: toCents(Number(t.amount)),
    orderId: t.orderId ?? undefined,
    paymentInstrument: t.paymentInstrumentType,
    last4: t.creditCard?.last4 ?? undefined,
    cardType: t.creditCard?.cardType ?? undefined,
    processorResponse: t.processorResponseText ?? undefined,
    updatedAt: String(t.updatedAt),
  };
}

function unwrap(op: string, r: braintree.ValidatedResponse<braintree.Transaction>): TxnView {
  if (r.success && r.transaction) return view(r.transaction);
  const t = (r as { transaction?: braintree.Transaction }).transaction;
  throw new PaymentError(op, r.message ?? "unknown error", t?.processorResponseCode);
}

/** Browser token for the Drop-in UI. */
export async function clientToken(): Promise<string> {
  const r = await gateway().clientToken.generate({});
  if (!r.success) throw new PaymentError("client_token", r.message ?? "failed");
  return r.clientToken;
}

/** Place the mandate's budget on hold. Does NOT move money. */
export async function holdBudget(mandateId: string, budget: Cents, paymentMethodNonce: string): Promise<TxnView> {
  const r = await gateway().transaction.sale({
    amount: fromCents(budget),
    paymentMethodNonce,
    orderId: mandateId,
    options: { submitForSettlement: false },
  });
  const t = unwrap("hold_budget", r);
  if (t.status !== "authorized") throw new PaymentError("hold_budget", `expected authorized, got ${t.status}`);
  return t;
}

/** Settle exactly the policy-validated total (<= hold). Amount never comes from the model. */
export async function settleExact(transactionId: string, amount: Cents): Promise<TxnView> {
  const current = await findTransaction(transactionId);
  if (current.status !== "authorized") throw new PaymentError("settle", `hold is ${current.status}, not authorized`);
  if (amount <= 0 || amount > current.amount) throw new PaymentError("settle", `amount ${amount} outside hold ${current.amount}`);
  return unwrap("settle", await gateway().transaction.submitForSettlement(transactionId, fromCents(amount)));
}

export async function releaseHold(transactionId: string): Promise<TxnView> {
  return unwrap("void", await gateway().transaction.void(transactionId));
}

export async function refund(transactionId: string, amount: Cents): Promise<TxnView> {
  return unwrap("refund", await gateway().transaction.refund(transactionId, fromCents(amount)));
}

export async function findTransaction(transactionId: string): Promise<TxnView> {
  return view(await gateway().transaction.find(transactionId));
}

/**
 * Sandbox only: Braintree settles in a nightly batch; this forces it for demos and tests.
 * The SDK's testing endpoint returns the raw API payload (not a ValidatedResponse), so the
 * outcome is confirmed by re-reading the transaction from Braintree.
 */
export async function sandboxSettle(transactionId: string): Promise<TxnView> {
  if (!isSandbox()) throw new Error("sandboxSettle is sandbox-only");
  await gateway().testing.settle(transactionId);
  const t = await findTransaction(transactionId);
  if (t.status !== "settled" && t.status !== "settling") throw new PaymentError("testing_settle", `expected settled, got ${t.status}`);
  return t;
}
