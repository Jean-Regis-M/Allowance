import { clientToken } from "@/lib/braintree";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({ clientToken: await clientToken() });
  } catch (e) {
    return fail(e, 500);
  }
}
