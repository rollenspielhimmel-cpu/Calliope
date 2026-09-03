import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { FORUM_VISIBILITY_SCHEMA } from "@/src/database/schema.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";
import { NOT_FOUND_RESPONSE, readerOf, THREAD_SUMMARY } from "./shared.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  jsonContent,
} from "@/src/http/response.ts";

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/threads/{threadId}",
    tags: [FORUM_TAG],
    summary: "Read one forum thread",
    description:
      "`effectiveVisibility` is what the thread is actually read at — the stricter of its own setting and its sub-forum's — which is what the interface uses to decide whether to offer a reply.",
    operationId: "getForumThread",
    request: { params: z.object({ threadId: z.uuidv7() }) },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The thread",
        content: jsonContent(
          THREAD_SUMMARY.extend({
            subForumId: z.uuidv7(),
            subForumTitle: z.string(),
            effectiveVisibility: FORUM_VISIBILITY_SCHEMA,
          }),
        ),
      },
      [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const thread = await ForumThreadService.selectThread(
      threadId,
      await readerOf(c),
    );

    if (thread === undefined) {
      return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
    }

    return c.json(thread, STATUS_CODE.OK);
  },
);
