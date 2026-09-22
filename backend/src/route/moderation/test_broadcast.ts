import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedToPreparePublications } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastService } from "@/src/service/broadcast_service.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Eine Test-Rundmail — so, wie sie ankäme, aber nur bei der Person, die den Knopf drückt.
 *
 * **Kein Empfänger im Anfragekörper, mit Absicht.** Was hier nicht steht, lässt sich auch nicht
 * falsch setzen: Die Test-Rundmail geht an die angemeldete Person, und an niemanden sonst. Rollen,
 * Namen und Archiv fehlen aus demselben Grund — eine Test-Rundmail hat keinen Empfängerkreis.
 *
 * Für beide Knöpfe dieselbe Route: beim Vorbereiten, wo es noch gar keine Rundmail gibt, und in der
 * Warteschlange, wo die Oberfläche den gespeicherten Stand schickt. Eine Kennung würde nur im
 * zweiten Fall passen.
 */
const TEST_BROADCAST_BODY = z.object({
  subject: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastSubject)),
  body: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastBody)),
  /** Null heißt: unter dem Konto, das dauerhaft zur Verfügung steht — wie bei der echten. */
  sendAsUserId: z.uuidv7().nullable(),
  /** Ist E-Mail gewählt, geht die Test-Mail an die eigene Adresse, mit „[TEST]" im Betreff. */
  deliverByEmail: z.boolean(),
});

const TEST_BROADCAST_RESPONSE = z.object({
  /** Der Test-Faden, damit die Oberfläche ihn öffnen kann. */
  chatGroupId: z.uuidv7(),
  /** Was aus der Mail an die eigene Adresse wurde. */
  email: z.enum(["sent", "not_chosen"]),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/broadcast/test",
    tags: [MODERATION_TAG],
    summary: "Send a broadcast to yourself, as a test",
    description:
      "Arrives exactly as the broadcast would, marked as a test, and only for the caller. No publication, no approval, no archive, and nothing counts as sent.",
    operationId: "sendTestBroadcast",
    middleware: [authenticated, authorizedToPreparePublications] as const,
    request: {
      body: { required: true, content: jsonContent(TEST_BROADCAST_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "In the caller's own inbox",
        content: jsonContent(TEST_BROADCAST_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "That account has not been released as a sender",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const outcome = await BroadcastService.sendTest(
      c.get("user"),
      c.req.valid("json"),
    );

    return outcome === "sender_not_released"
      ? c.json(
        {
          error:
            "Unter diesem Konto darf nicht gesendet werden. Freigeschaltet wird es vom Ur-Admin.",
        },
        STATUS_CODE.Forbidden,
      )
      : c.json(outcome, STATUS_CODE.OK);
  },
);
