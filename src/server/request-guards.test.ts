import { describe, expect, it } from "vitest";
import {
  sameOriginBrowserRequestAllowed,
  sameOriginMutationAllowed,
  sameOriginMutationRequired,
} from "./request-guards";

function request(headers: HeadersInit = {}) {
  return new Request("https://vibe-bots.test/api/account/claim", {
    method: "POST",
    headers,
  });
}

describe("sameOriginMutationAllowed", () => {
  it("allows same-origin browser requests", () => {
    expect(
      sameOriginBrowserRequestAllowed(
        request({
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("blocks cross-site browser requests", () => {
    expect(
      sameOriginBrowserRequestAllowed(
        request({
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("allows same-origin account mutations", () => {
    expect(
      sameOriginMutationAllowed(
        request({
          origin: "https://vibe-bots.test",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("allows server-side or harness requests without browser fetch headers", () => {
    expect(sameOriginMutationAllowed(request())).toBe(true);
  });

  it("blocks cross-site browser mutations", async () => {
    const res = sameOriginMutationRequired(
      request({
        origin: "https://evil.test",
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(res?.status).toBe(403);
    expect(res?.headers.get("Cache-Control")).toBe("no-store");
    await expect(res?.json()).resolves.toEqual({
      error: "same-origin request required",
      code: "same_origin_required",
    });
  });

  it("allows app-marked account mutations when embedded fetch metadata is cross-site", () => {
    expect(
      sameOriginMutationAllowed(
        request({
          origin: "https://remote-playtest.test",
          "sec-fetch-site": "cross-site",
          "x-vibebots-account-mutation": "1",
        }),
      ),
    ).toBe(true);
  });

  it("rejects malformed origin headers", () => {
    expect(sameOriginMutationAllowed(request({ origin: "null" }))).toBe(false);
  });
});
