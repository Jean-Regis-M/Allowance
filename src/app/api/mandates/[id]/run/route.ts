import { runMandate } from "@/lib/service";
import { assertSameOrigin, fail, ownedMandate, rateLimited } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Runs the purchasing agent and streams its activity as Server-Sent Events. Owner only. */
export async function POST(req: Request, { params }: Ctx) {
  const limited = rateLimited(req, "run", 15, 60 * 60 * 1000);
  if (limited) return limited;
  const { id } = await params;
  try {
    assertSameOrigin(req);
    ownedMandate(req, id);
  } catch (e) {
    return fail(e);
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await runMandate(id, send, { simulation: new URL(req.url).searchParams.get("mode") === "redteam" });
      } catch (e) {
        send({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        send({ kind: "end" });
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
