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
import { STATUS_UPDATE_SCHEMA } from "@/src/database/schema.ts";

export default new OpenAPIHono().openapi(
  createRoute({
    method: "delete",
    path: "/",
    tags: [STATUS_UPDATES_TAG],
    summary: "Delete your own status update",
    description:
      "The update goes, and its comments go with it — a thread without its beginning is not a thread. Everything is written to the deletion log first: the wording, who wrote it, who deleted it.",
    operationId: "deleteStatusUpdate",
    middleware: authenticated,
    request: {
      params: z.object({ statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id }),
    },
    responses: {
      [STATUS_CODE.NoContent]: { description: "Gone" },
      [STATUS_CODE.NotFound]: {
        description: "No such status update",
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
    const refusal = await db.transaction().execute((transaction) =>
      StatusUpdateService.deleteStatusUpdate(
        transaction,
        c.get("user"),
        c.req.valid("param").statusUpdateId,
      )
    );

    switch (refusal) {
      case "not_found":
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      case "not_yours":
        return c.json(
          { error: "Das ist nicht deine Statusmeldung." },
          STATUS_CODE.Forbidden,
        );
      default:
        return c.body(null, STATUS_CODE.NoContent);
    }
  },
);
