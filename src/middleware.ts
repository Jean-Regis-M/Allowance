/**
 * Owner identity for the demo: each browser gets an unguessable, httpOnly owner id.
 * The id is forwarded to route handlers in `x-owner-id`, which is ALWAYS overwritten
 * here, so a client cannot spoof it. Mandates are bound to this id.
 */
import { NextResponse, type NextRequest } from "next/server";

export const OWNER_COOKIE = "allowance_owner";
const VALID = /^[a-f0-9-]{36}$/;

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(OWNER_COOKIE)?.value;
  const owner = existing && VALID.test(existing) ? existing : crypto.randomUUID();

  const headers = new Headers(req.headers);
  headers.set("x-owner-id", owner);
  const res = NextResponse.next({ request: { headers } });

  if (owner !== existing) {
    res.cookies.set(OWNER_COOKIE, owner, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
