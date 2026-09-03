import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { FORUM_POST_SCHEMA } from "@/src/database/schema.ts";
import {
  listQuerySchema,
  listResponseSchema,
} from "@/src/list/list_endpoint.ts";
import { listQuery } from "@/src/list/list_endpoint_query.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";
import { NOT_FOUND_RESPONSE, POST_RESPONSE, readerOf } from "./shared.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  jsonContent,
} from "@/src/http/response.ts";

// Derived from the table rather than written out, as every list does: the value reaches
// `dynamic.ref`, so a column that is renamed has to fail to compile.
const SORT_ATTRIBUTE = FORUM_POST_SCHEMA
  .keyof()
  .extract(["createdAt"])
  .default("createdAt");

// `{}` passed rather than omitted: the parameter defaults to `{} as Filters`, which leaves the
// generic unresolved and widens the whole body to `Record<string, unknown>` at the handler.
const LIST_POSTS_BODY = listQuerySchema(SORT_ATTRIBUTE, {}, "asc");

/**
 * A page of posts and nothing else — the thread itself comes from `getForumThread`, the same
 * split the group's thread view uses. Wrapping the two in one response was tried and dropped:
 * `DOCUMENT_SCHEMA` inside a nested object exhausts the route's type inference and quietly
 * widens the request body to `Record<string, unknown>`.
 */
export default new OpenAPIHono().openapi(
  createRoute({
    method: "query",
    path: "/threads/{threadId}/posts",
    tags: [FORUM_TAG],
    summary: "List the posts of a forum thread",
    description:
      "Oldest first: a forum is read forwards. The thread decides whether any of this may be read, so one the reader may not see answers 404 and the posts are never reached.",
    operationId: "listForumPosts",
    request: {
      params: z.object({ threadId: z.uuidv7() }),
      body: { required: true, content: jsonContent(LIST_POSTS_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "A page of posts",
        content: jsonContent(listResponseSchema(POST_RESPONSE)),
      },
      [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const reader = await readerOf(c);

    // The thread is what decides visibility, so it is resolved even though it is not returned.
    if (await ForumThreadService.selectThread(threadId, reader) === undefined) {
      return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
    }

    return c.json(
      await ForumThreadService.listPosts(
        threadId,
        listQuery(c.req.valid("json")),
        reader,
      ),
      STATUS_CODE.OK,
    );
  },
);
