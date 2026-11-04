import { handleBraintreeWebhook } from "@/lib/webhooks";
import { fail, ok, rateLimited } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Braintree webhook endpoint (server-to-server). Authentication is the Braintree signature,
 * verified by the SDK; unsigned or tampered payloads are rejected with 400.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "webhook", 300, 60 * 60 * 1000);
  if (limited) return limited;
  try {
    const form = await req.formData();
    const signature = String(form.get("bt_signature") ?? "");
    const payload = String(form.get("bt_payload") ?? "");
    if (!signature || !payload) throw new Error("Missing bt_signature or bt_payload");
    return ok(await handleBraintreeWebhook(signature, payload));
  } catch (e) {
    return fail(e, 400);
  }
}
