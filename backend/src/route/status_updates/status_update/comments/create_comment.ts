import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "@/src/database/client.ts";
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
import {
  STATUS_UPDATE_COMMENT_SCHEMA,
  STATUS_UPDATE_SCHEMA,
} from "@/src/database/schema.ts";

const STATUS_UPDATE_PARAMS = z.object({
  statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id,
});

const CREATE_COMMENT_BODY = z.object({
  body: notBlank(z.string().max(TEXT_LIMIT.statusUpdateCommentBody)),
  /**
   * Der Kommentar, auf den sich dieser bezieht — statt seinen Text mitzuschicken.
   *
   * Der Text stand früher als `@name: „…"` im Kommentar selbst. Als Bezug bleibt das Zitat
   * richtig, wenn der zitierte Kommentar geändert wird, und der Name lässt sich verlinken.
   */
  quotedCommentId: STATUS_UPDATE_COMMENT_SCHEMA.shape.id.optional(),
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
        description: "No such status update, or no such comment to quote",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { statusUpdateId } = c.req.valid("param");
    const { body, quotedCommentId } = c.req.valid("json");

    const result = await db.transaction().execute((transaction) =>
      StatusUpdateService.createComment(
        transaction,
        statusUpdateId,
        c.get("user").id,
        body,
        quotedCommentId,
      )
    );

    switch (result) {
      case "not_found":
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      // Beides 404, aber nicht derselbe Satz: „Die Meldung gibt es nicht" und „den Kommentar, den
      // du zitierst, gibt es unter dieser Meldung nicht" schicken jemanden an verschiedene Orte.
      case "quoted_not_found":
        return c.json(
          { error: "Der zitierte Kommentar steht nicht unter dieser Meldung." },
          STATUS_CODE.NotFound,
        );
      default:
        return c.json(result, STATUS_CODE.Created);
    }
  },
);
