import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { FORUM_VISIBILITY_SCHEMA, USER_SCHEMA } from "@/src/database/schema.ts";
import { DOCUMENT_SCHEMA } from "@/src/document/document_schema.ts";
import { resolveSessionUser } from "@/src/middleware/session_user.ts";
import type { User } from "@/src/service/user_service.ts";
import { ERROR_RESPONSE, jsonContent } from "@/src/http/response.ts";
import { OWN_FAVOURITE } from "@/src/http/response_schema.ts";

/**
 * What the forum's routes share. They are one file each — the convention, and also what keeps
 * `c.req.valid("json")` typed: two `query` routes chained onto one app degrade the second one's
 * body to `Record<string, unknown>`.
 *
 * Reading needs no session, because a sub-forum may be open to everybody, so these resolve one by
 * hand rather than sitting behind `authenticated` — the same shape `pages/read_page.ts` uses.
 * Everything answers **404 rather than 403** for what a reader may not see, so its existence
 * stays hidden.
 */

/** A banned account reads the forum as nobody does, not as the member it was. */
export async function readerOf(c: Context): Promise<User | undefined> {
  const user = await resolveSessionUser(c);
  return user === undefined || user.bannedAt !== null ? undefined : user;
}

export const THREAD_SUMMARY = z.object({
  id: z.uuidv7(),
  title: z.string(),
  visibility: FORUM_VISIBILITY_SCHEMA.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  lastActivityAt: z.iso.datetime({ offset: true }),
  createdByUsername: USER_SCHEMA.shape.username.nullable(),
  posts: z.number().int(),
});

export const SUB_FORUM_RESPONSE = z.object({
  id: z.uuidv7(),
  title: z.string(),
  description: z.string(),
  visibility: FORUM_VISIBILITY_SCHEMA,
  categoryTitle: z.string(),
});

export const POST_RESPONSE = z.object({
  id: z.uuidv7(),
  document: DOCUMENT_SCHEMA,
  // The plain-text projection alongside the tree: the editor measures an edit against the same
  // bound the server does, and it cannot measure a document.
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: USER_SCHEMA.shape.id.nullable(),
  createdByUsername: USER_SCHEMA.shape.username.nullable(),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
  editedByUsername: USER_SCHEMA.shape.username.nullable(),
  // Always present, and always false for a reader without an account — see `listPosts`.
  ...OWN_FAVOURITE,
});

export const NOT_FOUND_RESPONSE = {
  description: "No such sub-forum or thread, or the reader may not see it",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export const MAY_NOT_POST_RESPONSE = {
  description: "Not signed in, or not allowed to write here",
  content: jsonContent(ERROR_RESPONSE),
} as const;
