import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { NOTIFICATIONS_TAG } from "@/src/open_api_specification.ts";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { BroadcastService } from "@/src/service/broadcast_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Eine Rundmail lesen, die man selbst bekommen hat.
 *
 * **Nur der zweite Fall braucht das.** Steht die Rundmail im Forum-Archiv, führt die Glocke
 * dorthin, und der Text hat genau eine Stelle. Ohne Archiv-Haken — eine Notiz an die
 * Administration etwa — gibt es keinen Forenbeitrag, und dann ist dieser Eintrag die eine Stelle.
 *
 * **Zugang über die eigene Benachrichtigung, nicht über eine Rolle.** Wer sie bekommen hat, hat
 * eine Zeile im Postfach; wer keine hat, hat sie nicht bekommen und liest sie auch nicht nach. Das
 * ist strenger als „ist Mitglied" und genau richtig: Eine Rundmail an die Administration ginge
 * sonst jeden an, der ihre Kennung errät.
 */

const BROADCAST_RESPONSE = z.object({
  subject: z.string(),
  body: z.string(),
  /** Unter welchem Namen sie erschien. Null heißt: unter dem Konto der Plattform selbst. */
  sendAsUsername: z.string().nullable(),
  releasedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Gesetzt, wenn sie auch im Forum steht — dann gehört sie dorthin und nicht hierher. */
  archiveThreadId: z.uuidv7().nullable(),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/{broadcastId}",
    tags: [NOTIFICATIONS_TAG],
    summary: "Read a broadcast from one's own inbox",
    description:
      "The text of a broadcast the signed-in member received. Refused with 404 rather than 403 when they did not receive it: whether a broadcast exists is itself something only its recipients need to know.",
    operationId: "readBroadcast",
    middleware: authenticated,
    request: { params: z.object({ broadcastId: z.uuidv7() }) },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The broadcast",
        content: jsonContent(BROADCAST_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such broadcast in this member's inbox",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...FORBIDDEN_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { broadcastId } = c.req.valid("param");

    const broadcast = await BroadcastService.readReceived(
      broadcastId,
      c.get("user").id,
    );

    if (broadcast === undefined) {
      return c.json(
        { error: "Diese Rundmail gibt es in deinem Postfach nicht." },
        STATUS_CODE.NotFound,
      );
    }

    return c.json(broadcast, STATUS_CODE.OK);
  },
);
