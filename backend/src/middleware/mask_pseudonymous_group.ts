import { createMiddleware } from "hono/factory";
import type { User } from "@/src/service/user_service.ts";
import { PseudonymService } from "@/src/service/pseudonym_service.ts";

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
 * exactly that — is invisible to it. That is what the OpenAPI-derived test is for; this handles the
 * common case so that thinking is only needed in the rare one.
 *
 * Non-JSON never reaches here with anything to hide: all 145 responses in the subtree are
 * `c.json`, and the two byte-level responses in the whole backend (an avatar image, the chat
 * stream) live elsewhere and carry no name.
 */

/**
 * The fields that name a person, and the field beside each that spells that person out.
 *
 * The convention this codebase already follows: an id `xBy` travels with an `xByUsername`. Listed
 * rather than derived, because a rule guessing from names would either miss a field or mask an
 * innocent one — and the test built from `open-api.json` is what notices a seventh.
 */
const PERSON_FIELDS: ReadonlyArray<
  { id: string; username: string; avatar?: string }
> = [
  { id: "createdBy", username: "createdByUsername" },
  { id: "editedBy", username: "editedByUsername" },
  { id: "updatedBy", username: "updatedByUsername" },
  { id: "invitedBy", username: "invitedByUsername" },
  { id: "actorId", username: "actorUsername" },
  // A membership names its person in the bare fields, being a row *about* somebody.
  { id: "userId", username: "username", avatar: "avatarUrl" },
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Rewrites in place on a freshly parsed body, which is nobody else's object.
 *
 * The reader's own id survives: every check the interface makes with it asks „is this mine", and
 * answering that about oneself reveals nothing. Everyone else's becomes null — the field is
 * already nullable everywhere it appears, so this is a value the client is built to handle rather
 * than a hole in the shape.
 */
function maskValue(
  value: Json,
  readerId: string,
  label: (userId: string | null) => { username: string; avatarUrl: null },
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      maskValue(entry, readerId, label);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const field of PERSON_FIELDS) {
    const id = value[field.id];

    if (typeof id !== "string" || id === readerId) {
      continue;
    }

    // The name first: once the id is gone there is nothing left to look the label up by.
    if (field.username in value) {
      value[field.username] = label(id).username;
    }

    if (field.avatar !== undefined && field.avatar in value) {
      value[field.avatar] = null;
    }

    value[field.id] = null;
  }

  for (const entry of Object.values(value)) {
    maskValue(entry, readerId, label);
  }
}

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
  maskValue(body, user.id, mask);

  c.res = new Response(JSON.stringify(body), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: c.res.headers,
  });
});
