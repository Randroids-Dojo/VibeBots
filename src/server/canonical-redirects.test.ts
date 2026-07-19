import { describe, expect, it } from "vitest";
import {
  CANONICAL_HOST,
  canonicalHostRedirects,
  VERCEL_ALIAS_HOST_PATTERN,
} from "./canonical-redirects";

const hostRegex = new RegExp(`^(?:${VERCEL_ALIAS_HOST_PATTERN})$`);

describe("canonicalHostRedirects", () => {
  it("returns no redirects outside production", () => {
    expect(canonicalHostRedirects(undefined)).toEqual([]);
    expect(canonicalHostRedirects("development")).toEqual([]);
    expect(canonicalHostRedirects("preview")).toEqual([]);
  });

  it("redirects vercel.app hosts to the canonical host in production", () => {
    const redirects = canonicalHostRedirects("production");
    expect(redirects).toHaveLength(1);
    const [redirect] = redirects;
    expect(redirect.source).toBe("/:path(.*)");
    expect(redirect.destination).toBe(`https://${CANONICAL_HOST}/:path`);
    expect(redirect.permanent).toBe(true);
    expect(redirect.has).toEqual([
      { type: "host", value: VERCEL_ALIAS_HOST_PATTERN },
    ]);
  });

  it("matches every production alias host shape", () => {
    expect(hostRegex.test("vibe-bots.vercel.app")).toBe(true);
    expect(hostRegex.test("vibe-bots-randroid88s-projects.vercel.app")).toBe(
      true,
    );
    expect(
      hostRegex.test("vibe-bots-git-main-randroid88s-projects.vercel.app"),
    ).toBe(true);
    expect(
      hostRegex.test("vibe-bots-7tlrxcg9k-randroid88s-projects.vercel.app"),
    ).toBe(true);
  });

  it("does not match the canonical host or local hosts", () => {
    expect(hostRegex.test(CANONICAL_HOST)).toBe(false);
    expect(hostRegex.test("localhost")).toBe(false);
    expect(hostRegex.test("localhost:3000")).toBe(false);
  });
});
