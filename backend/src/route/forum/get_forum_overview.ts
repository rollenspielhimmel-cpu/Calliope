import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { FORUM_VISIBILITY_SCHEMA, USER_SCHEMA } from "@/src/database/schema.ts";
import { resolveSessionUser } from "@/src/middleware/session_user.ts";
import { ForumStructureService } from "@/src/service/forum_structure_service.ts";
import { COMMON_RESPONSES, jsonContent } from "@/src/http/response.ts";

/**
 * Deliberately not behind `authenticated`: a sub-forum may be readable without an account, and
 * which ones those are is the data's own business. The session is resolved by hand for the same
 * reason `pages/read_page.ts` does it — a middleware would have to refuse before the answer is
 * known.
 */

const LAST_POST_RESPONSE = z.object({
  threadId: z.uuidv7(),
  threadTitle: z.string(),
  postId: z.uuidv7(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Null where the author's account has been deleted; the post itself stays. */
  createdByUsername: USER_SCHEMA.shape.username.nullable(),
});

const SUB_FORUM_RESPONSE = z.object({
  id: z.uuidv7(),
  title: z.string(),
  description: z.string(),
  visibility: FORUM_VISIBILITY_SCHEMA,
  position: z.number().int(),
  threads: z.number().int(),
  posts: z.number().int(),
  /**
   * Absent where nothing has been posted that this reader may see. Counted and named from the
   * same filter, so "no threads" and "a last post" cannot both be true.
   */
  lastPost: LAST_POST_RESPONSE.optional(),
});

const CATEGORY_RESPONSE = z.object({
  id: z.uuidv7(),
  title: z.string(),
  position: z.number().int(),
  subForums: z.array(SUB_FORUM_RESPONSE),
});

const FORUM_OVERVIEW_RESPONSE = z.object({
  categories: z.array(CATEGORY_RESPONSE),
  totalThreads: z.number().int(),
  totalPosts: z.number().int(),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: [FORUM_TAG],
    summary: "The forum, as this reader may see it",
    description:
      "Categories with their sub-forums, each carrying how many threads and posts it holds and which post is newest. Everything is filtered by what the reader may see: a sub-forum they may not read is absent rather than listed as refused, a category left with nothing in it is absent too, and the totals count only what was shown. Answers without a session, because a sub-forum may be readable without an account.",
    operationId: "getForumOverview",
    responses: {
      [STATUS_CODE.OK]: {
        description: "The forum's structure, filtered to this reader",
        content: jsonContent(FORUM_OVERVIEW_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    // A banned account reads the forum as nobody does, not as the member it was.
    const user = await resolveSessionUser(c);
    const reader = user === undefined || user.bannedAt !== null
      ? undefined
      : user;

    return c.json(
      await ForumStructureService.selectOverview(reader),
      STATUS_CODE.OK,
    );
  },
);
