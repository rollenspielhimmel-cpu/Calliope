import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATE_COMMENT_RESPONSE } from "@/src/http/response_schema.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import { STATUS_UPDATE_SCHEMA } from "@/src/database/schema.ts";

const STATUS_UPDATE_PARAMS = z.object({
  statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id,
});

const CREATE_COMMENT_BODY = z.object({
  body: notBlank(z.string().max(TEXT_LIMIT.statusUpdateCommentBody)),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: [STATUS_UPDATES_TAG],
    summary: "Comment on a status update",
    operationId: "createStatusUpdateComment",
    middleware: authenticated,
    request: {
      params: STATUS_UPDATE_PARAMS,
      body: { required: true, content: jsonContent(CREATE_COMMENT_BODY) },
    },
    responses: {
      [STATUS_CODE.Created]: {
        description: "The new comment",
        content: jsonContent(STATUS_UPDATE_COMMENT_RESPONSE),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such status update",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { statusUpdateId } = c.req.valid("param");
    const { body } = c.req.valid("json");

    const result = await StatusUpdateService.createComment(
      statusUpdateId,
      c.get("user").id,
      body,
    );

    return result === "not_found"
      ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
      : c.json(result, STATUS_CODE.Created);
  },
);
