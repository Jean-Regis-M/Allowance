import { getLedger } from "@/lib/store";
import { updateDraftRules } from "@/lib/service";
import { assertSameOrigin, fail, ok, ownedMandate } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const mandate = ownedMandate(req, id);
    return ok({ mandate, ledger: getLedger(id) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    ownedMandate(req, id);
    const body = (await req.json()) as Record<string, number | undefined>;
    return ok({ mandate: updateDraftRules(id, { budget: body.budget, autoApproveUnder: body.autoApproveUnder, maxUnitsPerProduct: body.maxUnitsPerProduct, mustArriveByDays: body.mustArriveByDays }) });
  } catch (e) {
    return fail(e);
  }
}
