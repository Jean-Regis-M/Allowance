import { approvePending, cancelMandate, fundMandate, refundOrder } from "@/lib/service";
import { assertSameOrigin, fail, ok, ownedMandate, rateLimited } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

/** Money-moving actions. Each one requires the caller to own the mandate and a same-origin request. */
export async function POST(req: Request, { params }: Ctx) {
  const { id, action } = await params;
  const limited = rateLimited(req, "pay", 40, 60 * 60 * 1000);
  if (limited) return limited;
  try {
    assertSameOrigin(req);
    ownedMandate(req, id);
    const body = (await req.json().catch(() => ({}))) as { nonce?: string; amount?: number; reason?: string };
    switch (action) {
      case "fund":
        if (!body.nonce) throw new Error("Missing payment method nonce.");
        return ok({ mandate: await fundMandate(id, body.nonce) });
      case "approve":
        return ok({ mandate: await approvePending(id) });
      case "cancel":
        return ok({ mandate: await cancelMandate(id) });
      case "refund":
        return ok({ mandate: await refundOrder(id, Number(body.amount), String(body.reason ?? "Owner-approved refund")) });
      default:
        return fail(new Error(`Unknown action ${action}`), 404);
    }
  } catch (e) {
    return fail(e);
  }
}
