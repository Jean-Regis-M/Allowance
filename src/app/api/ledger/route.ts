import { getLedgerForOwner, verifyLedger } from "@/lib/store";
import { fail, ok, ownerOf } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own ledger entries, plus integrity of the whole global chain. */
export async function GET(req: Request) {
  try {
    return ok({ entries: getLedgerForOwner(ownerOf(req)), verification: verifyLedger() });
  } catch (e) {
    return fail(e);
  }
}
