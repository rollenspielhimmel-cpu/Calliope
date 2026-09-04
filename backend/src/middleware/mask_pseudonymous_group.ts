import { createMiddleware } from "hono/factory";
import type { User } from "@/src/service/user_service.ts";
import { PseudonymService } from "@/src/service/pseudonym_service.ts";
import { type Json, maskPersonFields } from "@/src/service/person_fields.ts";

/**
 * Nobody in a Blind-Date group is named to the other, whatever the route below happens to return.
 *
 * **Why this exists rather than another masking call in another service.** Masking used to live in
 * the services that read group content — five of them — and it was therefore a thing somebody had
 * to remember. When a new feature arrived (a group's pages, taken from upstream) it did not
 * remember, because nothing in the code told it there are groups whose authors have no names. That
 * page then printed both partners' real usernames. The same would have happened to the next
 * feature, and to the one after.
 *
 * Everything group-scoped hangs under `/groups/:groupId`, so one place sees all of it — including
 * routes nobody has written yet. A new endpoint under that path is masked by default and its author
 * never has to know this file exists.
 *
 * **What it cannot do**, said plainly so nobody trusts it further than it reaches: it sees the
 * subtree and nothing else. A route that serves group content from somewhere else — search does
 * exactly that, and named a partner outright — is invisible to it. Search masks itself, with the
 * same field list from `person_fields.ts`, and the test built from `open-api.json` is what notices
 * the next place that needs to.
 *
 * Non-JSON never reaches here with anything to hide: all 145 responses in the subtree are
 * `c.json`, and the two byte-level responses in the whole backend (an avatar image, the chat
 * stream) live elsewhere and carry no name.
 */
export default createMiddleware<{
  Variables: { user: User };
}>(async (c, next) => {
  const groupId = c.req.param("groupId");

  await next();

  if (groupId === undefined) {
    return;
  }

  // One query, and only for a group that is actually pseudonymous — which is almost none of them.
  // Asked after `next()` so a request that was refused upstream does not pay for it.
  const mask = await PseudonymService.maskForGroup(groupId);

  if (mask === undefined) {
    return;
  }

  // Errors, empty bodies and anything that is not JSON pass untouched: there is no name in them,
  // and rewriting a body this does not understand would be worse than leaving it.
  if (!c.res.headers.get("content-type")?.includes("application/json")) {
    return;
  }

  const user = c.get("user");

  if (user === undefined) {
    return;
  }

  const body = await c.res.clone().json() as Json;
  maskPersonFields(body, user.id, mask);

  c.res = new Response(JSON.stringify(body), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: c.res.headers,
  });
});
