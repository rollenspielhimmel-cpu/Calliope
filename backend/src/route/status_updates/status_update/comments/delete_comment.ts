import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "@/src/database/client.ts";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import {
  STATUS_UPDATE_COMMENT_SCHEMA,
  STATUS_UPDATE_SCHEMA,
} from "@/src/database/schema.ts";

export default new OpenAPIHono().openapi(
  createRoute({
    method: "delete",
    path: "/{commentId}",
    tags: [STATUS_UPDATES_TAG],
    summary: "Delete your own comment",
    description:
      'The text goes, the line stays: „Kommentar gelöscht." takes its place, so replies quoting it keep their anchor. The wording is written to the deletion log first.',
    operationId: "deleteStatusUpdateComment",
    middleware: authenticated,
    request: {
      params: z.object({
        statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id,
        commentId: STATUS_UPDATE_COMMENT_SCHEMA.shape.id,
      }),
    },
    responses: {
      [STATUS_CODE.NoContent]: { description: "Gone" },
      [STATUS_CODE.NotFound]: {
        description: "No such comment, or already deleted",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Not yours",
        content: jsonContent(ERROR_RESPONSE),
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
    const { statusUpdateId, commentId } = c.req.valid("param");

    const refusal = await db.transaction().execute((transaction) =>
      StatusUpdateService.deleteComment(
        transaction,
        c.get("user"),
        statusUpdateId,
        commentId,
      )
    );

    switch (refusal) {
      case "not_found":
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      case "not_yours":
        return c.json(
          { error: "Das ist nicht dein Kommentar." },
          STATUS_CODE.Forbidden,
        );
      default:
        return c.body(null, STATUS_CODE.NoContent);
    }
  },
);
