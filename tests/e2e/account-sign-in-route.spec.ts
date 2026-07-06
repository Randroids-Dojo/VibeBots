import { type APIRequestContext, expect, test } from "@playwright/test";

async function expectClerkRouteOrNoKeyFallback(
  request: APIRequestContext,
  path: string,
) {
  const res = await request.get(path, { maxRedirects: 0 });

  if ([307, 308].includes(res.status())) {
    expect(res.headers().location).toBe("/mine?account=1");
    return;
  }

  expect(res.status()).toBe(200);
}

test("sign-in route serves Clerk or falls back without keys", async ({
  request,
}) => {
  await expectClerkRouteOrNoKeyFallback(request, "/sign-in");
});

test("sign-in route catches Clerk sign-in subpaths", async ({ request }) => {
  await expectClerkRouteOrNoKeyFallback(request, "/sign-in/factor-one");
});

test("sign-up route serves Clerk or falls back without keys", async ({
  request,
}) => {
  await expectClerkRouteOrNoKeyFallback(request, "/sign-up");
});
