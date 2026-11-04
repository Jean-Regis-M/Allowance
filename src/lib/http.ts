/** Route-handler helpers: JSON responses, owner authorization, same-origin checks, rate limits. */
import { NextResponse } from "next/server";
import type { Mandate } from "./domain";
import { getMandate } from "./store";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function fail(e: unknown, status = 400) {
  const code = e instanceof HttpError ? e.status : status;
  const message = e instanceof Error ? e.message : String(e);
  if (code >= 500) console.error("[api]", message);
  return NextResponse.json({ error: message }, { status: code });
}

/** Owner id set by middleware (never trusted from the client directly). */
export function ownerOf(req: Request): string {
  const id = req.headers.get("x-owner-id");
  if (!id) throw new HttpError(401, "No owner session. Reload the page and try again.");
  return id;
}

/**
 * Load a mandate and require that the caller owns it.
 * Not-owned and not-found both return 404, so mandate ids cannot be probed.
 */
export function ownedMandate(req: Request, id: string): Mandate {
  const owner = ownerOf(req);
  const m = getMandate(id);
  if (!m || m.ownerId !== owner) throw new HttpError(404, "Mandate not found");
  return m;
}

/** CSRF defence for state-changing requests: the Origin must match the Host. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / server-side calls; SameSite=Lax cookie still applies
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Bad origin");
  }
  if (!host || originHost !== host) throw new HttpError(403, "Cross-origin request refused");
}

const buckets = new Map<string, { count: number; reset: number }>();

/** Fixed-window limiter. Protects the hosted demo's AI quota from abuse. */
export function rateLimited(req: Request, key: string, limit: number, windowMs: number): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const id = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || b.reset < now) {
    buckets.set(id, { count: 1, reset: now + windowMs });
    return null;
  }
  if (b.count >= limit) {
    return NextResponse.json({ error: `Demo limit reached. Try again in ${Math.ceil((b.reset - now) / 60000)} min.` }, { status: 429 });
  }
  b.count++;
  return null;
}
