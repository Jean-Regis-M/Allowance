import { ok } from "@/lib/http";
import { isSandbox } from "@/lib/braintree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    status: "ok",
    paymentEnvironment: isSandbox() ? "sandbox" : "production",
    braintreeConfigured: Boolean(process.env.BRAINTREE_MERCHANT_ID && process.env.BRAINTREE_PRIVATE_KEY),
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
}
