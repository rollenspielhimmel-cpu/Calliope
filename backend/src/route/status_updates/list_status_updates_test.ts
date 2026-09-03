import { assert, assertEquals, assertFalse } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import {
  clearRateLimits,
  deleteUsers,
  registerUser,
  request,
} from "@/src/test/support.ts";

const author = "status-list-author";
const other = "status-list-other";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(() => deleteUsers([author, other]));

async function post(cookie: string, body: string) {
  const response = await request("POST", "/api/status-updates", cookie, {
    body,
  });
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json();
}

async function list(cookie: string, body: unknown = {}) {
  const response = await request("QUERY", "/api/status-updates", cookie, body);
  assertEquals(response.status, STATUS_CODE.OK);
  return await response.json();
}

/**
 * Pages through the whole feed by following `nextCursor`. The feed is global — nothing scopes
 * it to a group or a chat — so another test file's own status updates can land anywhere in it
 * while this one runs. Walking every page and then filtering to this test's own ids (by
 * comparing against ids it captured, never a bare `results[0]` or a total count) is what keeps
 * these tests honest under `--parallel`, the same reasoning `search_test.ts` uses for a shared
 * table it does not own alone.
 */
async function everything(cookie: string, limit = 30) {
  const results: Array<{ id: string; commentCount: number }> = [];
  let before: string | undefined;

  for (;;) {
    const query = before === undefined ? { limit } : { limit, before };
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one page at a time
    const page = await list(cookie, query);
    results.push(...page.results);
    if (page.nextCursor === null) break;
    before = page.nextCursor;
  }

  return results;
}

Deno.test("QUERY /api/status-updates lists newest first", async () => {
  const cookie = await registerUser(author);
  const marker = `status-list-order-${crypto.randomUUID()}`;

  const first = await post(cookie, `${marker} eins`);
  const second = await post(cookie, `${marker} zwei`);
  const third = await post(cookie, `${marker} drei`);

  const all = await everything(cookie);
  const ids = new Set([first.id, second.id, third.id]);
  const mine = all.filter((update) => ids.has(update.id)).map((
    update,
  ) => update.id);

  assertEquals(mine, [third.id, second.id, first.id]);
});

Deno.test("QUERY /api/status-updates reports how many comments each update has", async () => {
  const cookie = await registerUser(author);
  const commenterCookie = await registerUser(other);

  const withComments = await post(cookie, "status-list-commentcount mit");
  const withoutComments = await post(cookie, "status-list-commentcount ohne");

  for (const body of ["Erster Kommentar", "Zweiter Kommentar"]) {
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one case per iteration
    const response = await request(
      "POST",
      `/api/status-updates/${withComments.id}/comments`,
      commenterCookie,
      { body },
    );
    assertEquals(response.status, STATUS_CODE.Created);
  }

  const all = await everything(cookie);
  assertEquals(
    all.find((update) => update.id === withComments.id)?.commentCount,
    2,
  );
  assertEquals(
    all.find((update) => update.id === withoutComments.id)?.commentCount,
    0,
  );
});

Deno.test("QUERY /api/status-updates pages by cursor across more than one page", async () => {
  const cookie = await registerUser(author);
  const marker = `status-list-page-${crypto.randomUUID()}`;

  const created = [];
  for (let index = 0; index < 5; index++) {
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one case per iteration
    created.push(await post(cookie, `${marker} ${index}`));
  }
  // Newest first, matching how the feed reads.
  const expectedOrder = created.map((update) => update.id).toReversed();

  const seen: string[] = [];
  let before: string | undefined;
  let pages = 0;

  for (;;) {
    const query = before === undefined ? { limit: 2 } : { limit: 2, before };
    // deno-lint-ignore no-await-in-loop -- sequential on purpose, one page at a time
    const page = await list(cookie, query);
    seen.push(...page.results.map((update: { id: string }) => update.id));
    pages++;
    if (page.nextCursor === null) break;
    before = page.nextCursor;
    assert(pages < 1000, "paging did not terminate");
  }

  // Five of this test's own updates alone, two per page, could not have fit on one page.
  assert(pages >= 3, "expected at least three pages");
  assertEquals(
    new Set(seen).size,
    seen.length,
    "no update repeats across pages",
  );
  const mine = seen.filter((id) => expectedOrder.includes(id));
  assertEquals(mine, expectedOrder);
});

Deno.test("QUERY /api/status-updates needs a session", async () => {
  const response = await request("QUERY", "/api/status-updates", "", {});

  assertEquals(response.status, STATUS_CODE.Unauthorized);
  assertFalse(response.headers.has("set-cookie"));
});
