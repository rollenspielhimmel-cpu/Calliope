import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATE_COMMENT_RESPONSE } from "@/src/http/response_schema.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import { STATUS_UPDATE_SCHEMA } from "@/src/database/schema.ts";

const STATUS_UPDATE_PARAMS = z.object({
  statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id,
});

// GET rather than QUERY: nothing here is sorted, searched or paged — the whole conversation
// under one status update, small by nature, the same reasoning as a group's steps.
export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: [STATUS_UPDATES_TAG],
    summary: "List a status update's comments",
    description: "Oldest first, the way a conversation reads.",
    operationId: "listStatusUpdateComments",
    middleware: authenticated,
    request: { params: STATUS_UPDATE_PARAMS },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The comments, oldest first",
        content: jsonContent(
          z.object({ results: z.array(STATUS_UPDATE_COMMENT_RESPONSE) }),
        ),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such status update",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { statusUpdateId } = c.req.valid("param");
    const result = await StatusUpdateService.listComments(statusUpdateId);

    return result === "not_found"
      ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
      : c.json({ results: result }, STATUS_CODE.OK);
  },
);
