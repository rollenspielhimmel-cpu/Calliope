import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastQueueService } from "@/src/service/broadcast_queue_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Eine versendete Rundmail zurückziehen.
 *
 * **Nur der Ur-Admin.** Das Mittelstück lässt jede Administration durch; wer darüber hinaus der
 * Ur-Admin sein muss, entscheidet der Dienst — die Rolle allein reicht nicht, und genau das ist die
 * Regel. Was verschwindet und was bleibt, steht bei `retract` in `broadcast_queue_service.ts`.
 */

const PARAMS = z.object({ publicationId: z.uuidv7() });

const RETRACTED_RESPONSE = z.object({
  retractedAt: z.iso.datetime({ offset: true }),
  /** In wie vielen Postfächern der Text ersetzt wurde. */
  inboxes: z.number().int(),
  /** Ob auch ein Beitrag im Archiv ersetzt wurde. */
  archived: z.boolean(),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/broadcast/released/{publicationId}/retraction",
    tags: [MODERATION_TAG],
    summary: "Retract a broadcast that has gone out",
    description:
      "Only the first administrator. Replaces the text and subject in every inbox and the archive post with a note that it was retracted, and keeps who retracted it and when. Mails already handed to the relay cannot be recalled; the rest are stopped.",
    operationId: "retractBroadcast",
    middleware: [authenticated, authorizedAsAdministrator] as const,
    request: { params: PARAMS },
    responses: {
      [STATUS_CODE.OK]: {
        description: "Retracted",
        content: jsonContent(RETRACTED_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Only the first administrator retracts",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such broadcast",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Conflict]: {
        description: "Not sent yet, or already retracted",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const outcome = await BroadcastQueueService.retract(
      c.req.valid("param").publicationId,
      c.get("user"),
    );

    if (typeof outcome !== "string") {
      return c.json(outcome, STATUS_CODE.OK);
    }

    switch (outcome) {
      case "not_the_first_administrator":
        return c.json(
          { error: "Zurückziehen kann nur der Ur-Admin." },
          STATUS_CODE.Forbidden,
        );
      case "not_found":
        return c.json(
          { error: "Diese Rundmail gibt es nicht." },
          STATUS_CODE.NotFound,
        );
      case "not_released":
        return c.json(
          {
            error:
              "Sie ist noch nicht versendet. Was noch wartet, wird verworfen, nicht zurückgezogen.",
          },
          STATUS_CODE.Conflict,
        );
      case "already_retracted":
        return c.json(
          { error: "Sie ist schon zurückgezogen." },
          STATUS_CODE.Conflict,
        );
      default:
        return assertUnreachable(outcome);
    }
  },
);
