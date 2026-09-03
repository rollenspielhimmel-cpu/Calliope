import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATE_RESPONSE } from "@/src/http/response_schema.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import {
  cursorQuerySchema,
  cursorResponseSchema,
} from "@/src/list/list_endpoint.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

export default new OpenAPIHono().openapi(
  createRoute({
    method: "query",
    path: "/",
    tags: [STATUS_UPDATES_TAG],
    summary: "List status updates",
    description:
      "The logged-in home page's feed, newest first, with each update's comment count. Paged by cursor rather than offset, the same reasoning as a chat's messages: a status posted while somebody reads would otherwise shift the window and make page two repeat or skip whatever crossed the boundary.",
    operationId: "listStatusUpdates",
    middleware: authenticated,
    request: {
      body: { required: true, content: jsonContent(cursorQuerySchema()) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "A page of status updates, newest first",
        content: jsonContent(cursorResponseSchema(STATUS_UPDATE_RESPONSE)),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const page = await StatusUpdateService.listStatusUpdates(
      c.req.valid("json"),
    );
    return c.json(page, STATUS_CODE.OK);
  },
);
