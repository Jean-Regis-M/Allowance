/**
 * PayPal Braintree webhooks. Braintree pushes settlement outcomes (settled, settlement declined,
 * disbursed). The signature is verified by the SDK; tampered or forged payloads are rejected.
 * Deliveries are idempotent and every accepted notification is written to the audit ledger.
 */
import type braintree from "braintree";
import { gateway } from "./braintree";
import { appendLedger, getLedger, listMandates, saveMandate } from "./store";
import type { Mandate } from "./domain";

const TRANSACTION_KINDS = new Set(["transaction_settled", "transaction_settlement_declined", "transaction_disbursed"]);

export interface WebhookResult {
  kind: string;
  handled: boolean;
  duplicate?: boolean;
  mandateId?: string;
  reason?: string;
}

function mandateForTransaction(txnId: string): Mandate | undefined {
  return listMandates().find((m) => m.holdId === txnId || m.order?.transactionId === txnId);
}

export async function handleBraintreeWebhook(signature: string, payload: string, gw: braintree.BraintreeGateway = gateway()): Promise<WebhookResult> {
  // Throws InvalidSignatureError if the payload was not signed with our keys.
  const n = await gw.webhookNotification.parse(signature, payload);
  const kind = String(n.kind);
  if (!TRANSACTION_KINDS.has(kind)) return { kind, handled: false, reason: "kind not used by Allowance" };

  const txn = (n as braintree.TransactionNotification).transaction;
  const m = mandateForTransaction(txn.id);
  if (!m) return { kind, handled: false, reason: "no mandate for this transaction" };

  const type = `webhook.${kind}`;
  const stamp = String(n.timestamp);
  if (getLedger(m.id).some((e) => e.type === type && (e.data as { timestamp?: string }).timestamp === stamp)) {
    return { kind, handled: true, duplicate: true, mandateId: m.id };
  }

  const status = kind === "transaction_settled" ? "settled" : kind === "transaction_settlement_declined" ? "settlement_declined" : "disbursed";
  if (m.order && kind !== "transaction_disbursed") {
    m.order.gatewayStatus = status;
    saveMandate(m);
  }
  appendLedger(
    m.id,
    "paypal",
    type,
    `Verified PayPal Braintree webhook: transaction ${txn.id} ${status.replace("_", " ")}`,
    { transactionId: txn.id, kind, timestamp: stamp, status: txn.status },
  );
  return { kind, handled: true, mandateId: m.id };
}
