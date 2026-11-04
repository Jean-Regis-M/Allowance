import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin, HttpError, ownedMandate } from "../src/lib/http";
import { listMandates, resetDatabaseForTests } from "../src/lib/store";
import { draftMandate } from "../src/lib/service";
import { middleware, OWNER_COOKIE } from "../src/middleware";
import type { MandateDraft } from "../src/lib/domain";

const draft: MandateDraft = {
  title: "Restock", purpose: "p", budgetUSD: 100, maxPerItemUSD: 0, allowedCategories: ["packaging"], allowedMerchants: [],
  mustArriveByDays: 0, maxUnitsPerProduct: 5, preferences: [], questions: [],
};
const compile = async () => draft;
const req = (owner: string | null, extra: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/x", { method: "POST", headers: { host: "localhost:3000", ...(owner ? { "x-owner-id": owner } : {}), ...extra } });

beforeEach(() => resetDatabaseForTests(":memory:"));

describe("mandate authorization", () => {
  it("lets the owner load their mandate and hides it from everyone else", async () => {
    const { mandate } = await draftMandate("Buy cups please", { compile, ownerId: "alice" });
    expect(ownedMandate(req("alice"), mandate.id).id).toBe(mandate.id);
    expect(() => ownedMandate(req("mallory"), mandate.id)).toThrow(HttpError);
    try {
      ownedMandate(req("mallory"), mandate.id);
    } catch (e) {
      expect((e as HttpError).status).toBe(404); // indistinguishable from not-found
    }
    expect(() => ownedMandate(req(null), mandate.id)).toThrow(/owner session/);
  });

  it("lists only the caller's mandates", async () => {
    await draftMandate("Buy cups please", { compile, ownerId: "alice" });
    await draftMandate("Buy lids please", { compile, ownerId: "bob" });
    expect(listMandates("alice")).toHaveLength(1);
    expect(listMandates("bob")).toHaveLength(1);
    expect(listMandates("mallory")).toHaveLength(0);
  });

  it("refuses cross-origin state changes", () => {
    expect(() => assertSameOrigin(req("alice", { origin: "https://evil.example" }))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req("alice", { origin: "http://localhost:3000" }))).not.toThrow();
  });
});

describe("owner middleware", () => {
  it("issues an httpOnly owner cookie and overwrites any spoofed x-owner-id header", () => {
    const res = middleware(new NextRequest("http://localhost:3000/", { headers: { "x-owner-id": "spoofed" } }));
    const cookie = res.cookies.get(OWNER_COOKIE);
    expect(cookie?.value).toMatch(/^[a-f0-9-]{36}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(res.headers.get("x-middleware-request-x-owner-id")).toBe(cookie?.value);
  });

  it("keeps a valid existing cookie and ignores malformed ones", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const keep = middleware(new NextRequest("http://localhost:3000/", { headers: { cookie: `${OWNER_COOKIE}=${id}` } }));
    expect(keep.headers.get("x-middleware-request-x-owner-id")).toBe(id);
    const bad = middleware(new NextRequest("http://localhost:3000/", { headers: { cookie: `${OWNER_COOKIE}=../../admin` } }));
    expect(bad.headers.get("x-middleware-request-x-owner-id")).not.toBe("../../admin");
  });
});
