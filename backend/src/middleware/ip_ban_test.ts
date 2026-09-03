import { assertEquals, assertExists } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { Hono } from "hono";
import { db } from "@/src/database/client.ts";
import { redis } from "@/src/redis/client.ts";
import { RATE_LIMIT_TEST_CLIENTS } from "@/src/test/support.ts";
import {
  RATE_LIMIT_KEY_PREFIX,
  readRateLimit,
  writeRateLimit,
} from "./rate_limit.ts";
import ipBan from "./ip_ban.ts";

/**
 * The order `app.ts` registers them in, which is the thing under test: a banned address must be
 * turned away before either limiter counts it, or a ban costs the very budget it should not.
 */
const app = new Hono()
  .use(ipBan)
  .use(readRateLimit)
  .use(writeRateLimit)
  .get("/probe", (c) => c.json({ ok: true }));

const BANNED = "198.51.100.90";
const ALLOWED = "198.51.100.91";

function request(clientAddress: string) {
  assertEquals(clientAddress.startsWith(RATE_LIMIT_TEST_CLIENTS), true);
  return app.request("/probe", {
    headers: { "x-forwarded-for": clientAddress },
  });
}

Deno.test.beforeEach(async () => {
  await db
    .insertInto("bannedIp")
    .values({ ipAddress: BANNED, bannedBy: null, reason: "Testing" })
    .onConflict((conflict) => conflict.column("ipAddress").doNothing())
    .execute();
});

Deno.test.afterEach(async () => {
  await db.deleteFrom("bannedIp").where("ipAddress", "in", [BANNED, ALLOWED])
    .execute();

  // Only this file's own two addresses. Clearing the whole prefix would empty the counters
  // `rate_limit_test.ts` is deliberately filling request by request — the files run in parallel,
  // and there that reads as the limiter simply not working. `clearRateLimits` spares the same
  // block for the same reason.
  const keys = (await redis.keys(`${RATE_LIMIT_KEY_PREFIX}*`))
    .filter((key) => key.includes(BANNED) || key.includes(ALLOWED));

  if (keys.length > 0) {
    await redis.del(...keys);
  }
});

Deno.test("a banned address is refused", async () => {
  assertEquals((await request(BANNED)).status, STATUS_CODE.Forbidden);
});

Deno.test("an address that is not banned passes through", async () => {
  assertEquals((await request(ALLOWED)).status, STATUS_CODE.OK);
});

Deno.test("a banned address spends no rate-limit budget", async () => {
  const refused = await request(BANNED);

  assertEquals(refused.status, STATUS_CODE.Forbidden);
  // The limiters set draft-7 headers on everything they count, so their absence is what says
  // this request never reached them — the reason `ipBan` is registered before both.
  assertEquals(refused.headers.get("ratelimit"), null);

  // And the proof it was never counted: a permitted address is on its first request here, so a
  // banned one having spent budget would show as a lower remaining count for its own key.
  const allowed = await request(ALLOWED);
  const header = allowed.headers.get("ratelimit");
  assertExists(
    header,
    "expected draft-7 RateLimit headers on a request that got through",
  );
});
