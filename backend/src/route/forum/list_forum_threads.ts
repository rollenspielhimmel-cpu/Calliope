import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import {
  listQuerySchema,
  listResponseSchema,
} from "@/src/list/list_endpoint.ts";
import { listQuery } from "@/src/list/list_endpoint_query.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";
import {
  NOT_FOUND_RESPONSE,
  readerOf,
  SUB_FORUM_RESPONSE,
  THREAD_SUMMARY,
} from "./shared.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  jsonContent,
} from "@/src/http/response.ts";

const LIST_THREADS_BODY = listQuerySchema(
  z.enum(["lastActivityAt", "createdAt", "title"]).default("lastActivityAt"),
  {},
  "desc",
);

export default new OpenAPIHono().openapi(
  createRoute({
    method: "query",
    path: "/sub-forums/{subForumId}/threads",
    tags: [FORUM_TAG],
    summary: "List the threads of a sub-forum",
    description:
      "Newest activity first by default. A thread the reader may not see is absent and is not counted, so the total describes what was actually shown.",
    operationId: "listForumThreads",
    request: {
      params: z.object({ subForumId: z.uuidv7() }),
      body: { required: true, content: jsonContent(LIST_THREADS_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The sub-forum and a page of its threads",
        content: jsonContent(
          z.object({
            subForum: SUB_FORUM_RESPONSE,
            threads: listResponseSchema(THREAD_SUMMARY),
          }),
        ),
      },
      [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { subForumId } = c.req.valid("param");
    const reader = await readerOf(c);

    const subForum = await ForumThreadService.selectSubForum(
      subForumId,
      reader,
    );

    if (subForum === undefined) {
      return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
    }

    const threads = await ForumThreadService.listThreads(
      subForumId,
      reader,
      listQuery(c.req.valid("json")),
    );

    return c.json({ subForum, threads }, STATUS_CODE.OK);
  },
);
