import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATE_RESPONSE } from "@/src/http/response_schema.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

const CREATE_STATUS_UPDATE_BODY = z.object({
  body: notBlank(z.string().max(TEXT_LIMIT.statusUpdateBody)),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: [STATUS_UPDATES_TAG],
    summary: "Post a status update",
    description: "A short remark on the logged-in home page.",
    operationId: "createStatusUpdate",
    middleware: authenticated,
    request: {
      body: { required: true, content: jsonContent(CREATE_STATUS_UPDATE_BODY) },
    },
    responses: {
      [STATUS_CODE.Created]: {
        description: "The new status update",
        content: jsonContent(STATUS_UPDATE_RESPONSE),
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
    const { body } = c.req.valid("json");
    const statusUpdate = await StatusUpdateService.createStatusUpdate(
      c.get("user").id,
      body,
    );
    return c.json(statusUpdate, STATUS_CODE.Created);
  },
);
