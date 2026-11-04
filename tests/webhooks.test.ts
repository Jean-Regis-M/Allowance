import { beforeEach, describe, expect, it } from "vitest";
import braintree from "braintree";
import { handleBraintreeWebhook } from "../src/lib/webhooks";
import { getLedger, getMandate, resetDatabaseForTests, saveMandate } from "../src/lib/store";
import type { Mandate } from "../src/lib/domain";

// Offline gateway with dummy sandbox keys: Braintree signs sample notifications locally.
const gw = new braintree.BraintreeGateway({ environment: braintree.Environment.Sandbox, merchantId: "m_test", publicKey: "pub_test", privateKey: "priv_test" });
const other = new braintree.BraintreeGateway({ environment: braintree.Environment.Sandbox, merchantId: "m_test", publicKey: "pub_test", privateKey: "attacker_key" });

function settledMandate(txn: string): Mandate {
  return {
    id: "md_wh", ownerId: "o", title: "t", purpose: "p", request: "r", preferences: [], status: "SETTLED",
    holdId: txn, authorizedAmount: 18000, capturedAmount: 11923, pendingCart: null, createdAt: new Date().toISOString(),
    order: { lines: [], total: 11923, rationale: "", transactionId: txn, gatewayStatus: "submitted_for_settlement", settledAt: "", refunded: 0 },
    rules: { budget: 18000, maxPerItem: 0, allowedCategories: [], allowedMerchants: [], mustArriveByDays: 0, maxUnitsPerProduct: 6, autoApproveUnder: 15000, expiresAt: new Date(Date.now() + 1e8).toISOString() },
  };
}

beforeEach(() => resetDatabaseForTests(":memory:"));

describe("Braintree webhooks", () => {
  it("accepts a signed transaction_settled notification and records it once", async () => {
    saveMandate(settledMandate("txn_abc"));
    const n = await gw.webhookTesting.sampleNotification("transaction_settled", "txn_abc");
    const r = await handleBraintreeWebhook(n.bt_signature, n.bt_payload, gw);
    expect(r).toMatchObject({ handled: true, mandateId: "md_wh" });
    expect(getMandate("md_wh")?.order?.gatewayStatus).toBe("settled");
    const again = await handleBraintreeWebhook(n.bt_signature, n.bt_payload, gw);
    expect(again.duplicate).toBe(true);
    expect(getLedger("md_wh").filter((e) => e.type === "webhook.transaction_settled")).toHaveLength(1);
  });

  it("marks a declined settlement", async () => {
    saveMandate(settledMandate("txn_dec"));
    const n = await gw.webhookTesting.sampleNotification("transaction_settlement_declined", "txn_dec");
    await handleBraintreeWebhook(n.bt_signature, n.bt_payload, gw);
    expect(getMandate("md_wh")?.order?.gatewayStatus).toBe("settlement_declined");
  });

  it("rejects payloads signed with a different key", async () => {
    saveMandate(settledMandate("txn_abc"));
    const forged = await other.webhookTesting.sampleNotification("transaction_settled", "txn_abc");
    await expect(handleBraintreeWebhook(forged.bt_signature, forged.bt_payload, gw)).rejects.toThrow();
    expect(getLedger("md_wh")).toHaveLength(0);
  });

  it("ignores transactions that belong to no mandate", async () => {
    const n = await gw.webhookTesting.sampleNotification("transaction_settled", "txn_unknown");
    const r = await handleBraintreeWebhook(n.bt_signature, n.bt_payload, gw);
    expect(r.handled).toBe(false);
  });
});
