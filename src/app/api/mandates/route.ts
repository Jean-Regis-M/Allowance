import { draftMandate } from "@/lib/service";
import { listMandates } from "@/lib/store";
import { assertSameOrigin, fail, ok, ownerOf, rateLimited } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return ok({ mandates: listMandates(ownerOf(req)) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "draft", 20, 60 * 60 * 1000);
  if (limited) return limited;
  try {
    assertSameOrigin(req);
    const ownerId = ownerOf(req);
    const { request } = (await req.json()) as { request?: string };
    return ok(await draftMandate(String(request ?? ""), { ownerId }), 201);
  } catch (e) {
    return fail(e);
  }
}
