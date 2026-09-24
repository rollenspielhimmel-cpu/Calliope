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

const STATUS_UPDATE_PARAMS = z.object({
  statusUpdateId: STATUS_UPDATE_SCHEMA.shape.id,
});

/**
 * Was für diese eine Meldung gilt, und ob es ausdrücklich so gesetzt wurde.
 *
 * Die Oberfläche braucht beides: Sie schreibt an den Knopf, was als Nächstes passiert, und muss
 * dafür wissen, ob gerade Mitteilungen kämen — ob aus der Regel oder weil jemand es gesagt hat.
 */
const SUBSCRIPTION_RESPONSE = z.object({
  subscribed: z.boolean(),
  /** Falsch heißt: Es gilt die Regel — Verfasserin und alle, die kommentiert haben. */
  explicit: z.boolean(),
});

const SET_SUBSCRIPTION_BODY = z.object({
  /**
   * `true` heißt an, `false` aus, `null` zurück auf die Regel.
   *
   * Drei Stellungen und nicht zwei: Wer nichts geschrieben hat, aber mitlesen will, braucht das
   * Ja; wer mitgeschrieben hat und Ruhe will, das Nein. Und wer es sich anders überlegt, soll
   * zurück können, ohne raten zu müssen, was „die Regel" für ihn bedeutet.
   */
  subscribed: z.boolean().nullable(),
});

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [STATUS_UPDATES_TAG],
      summary: "Whether this status update sends notifications",
      description:
        "What is set for this one status update, and whether it was set explicitly or follows the rule — the author and everybody who has commented are told by default.",
      operationId: "getStatusUpdateSubscription",
      middleware: authenticated,
      request: { params: STATUS_UPDATE_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "What applies here",
          content: jsonContent(SUBSCRIPTION_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: {
          description: "No valid session",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await StatusUpdateService.subscriptionFor(
          c.req.valid("param").statusUpdateId,
          c.get("user").id,
        ),
        STATUS_CODE.OK,
      ),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/",
      tags: [STATUS_UPDATES_TAG],
      summary: "Turn notifications for this status update on or off",
      description:
        "`true` asks for them even without having written anything, `false` asks for quiet even after having written, `null` goes back to the rule.",
      operationId: "setStatusUpdateSubscription",
      middleware: authenticated,
      request: {
        params: STATUS_UPDATE_PARAMS,
        body: { required: true, content: jsonContent(SET_SUBSCRIPTION_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "What applies now",
          content: jsonContent(SUBSCRIPTION_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such status update",
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
      const { statusUpdateId } = c.req.valid("param");
      const { subscribed } = c.req.valid("json");
      const userId = c.get("user").id;

      const refusal = await db.transaction().execute((transaction) =>
        StatusUpdateService.setSubscription(
          transaction,
          statusUpdateId,
          userId,
          subscribed ?? undefined,
        )
      );

      if (refusal === "not_found") {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      // Zurückgelesen statt zurückgegeben: Wer auf „die Regel" zurückgeht, will wissen, was die
      // Regel für ihn bedeutet — und das hängt daran, ob er kommentiert hat.
      return c.json(
        await StatusUpdateService.subscriptionFor(statusUpdateId, userId),
        STATUS_CODE.OK,
      );
    },
  );
