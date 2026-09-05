import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastQueueService } from "@/src/service/broadcast_queue_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Die Warteschlange der Rundmails: einreichen, freigeben, verwerfen — und nachsehen, was raus ist.
 *
 * Alles hier ist der Administration vorbehalten; die Moderation sieht die Rundmail gar nicht. Wer
 * freigeben darf und warum nicht die eigene Einreichung, steht in `broadcast_queue_service.ts`.
 */

const BROADCAST_BODY = z.object({
  subject: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastSubject)),
  body: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastBody)),
  audienceGroups: z
    .array(z.enum(["administrator", "moderator", "member"]))
    .min(1),
  includeUnverified: z.boolean(),
  /** Null heißt: unter dem Konto, das dauerhaft zur Verfügung steht. */
  sendAsUserId: z.uuidv7().nullable(),
  /**
   * Frühestens wann, oder null für „sobald freigegeben". In UTC — die Oberfläche rechnet den
   * eingetippten Zeitpunkt aus Europe/Berlin um, damit die Sommerzeit an genau einer Stelle
   * bedacht werden muss.
   */
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
});

const BROADCAST_RESPONSE = BROADCAST_BODY.extend({
  publicationId: z.uuidv7(),
  status: z.enum([
    "draft",
    "awaiting_approval",
    "approved",
    "released",
    "discarded",
  ]),
  /** Nach außen sichtbar: unter welchem Namen sie erscheint. */
  sendAsUsername: z.string().nullable(),
  /**
   * Intern: wer sie geschrieben und wer sie freigegeben hat. Beide echten Namen, auch wenn außen
   * jemand anderes draufsteht — das ist der Sinn der Sache, und die Liste ist ohnehin nur für die
   * Administration sichtbar.
   */
  writtenByUsername: z.string().nullable(),
  writtenAt: z.iso.datetime({ offset: true }),
  approvedByUsername: z.string().nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  releasedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Beim Versand festgehalten, nicht später gezählt. */
  recipientCount: z.number().int().nullable(),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const publicationId = z.object({ publicationId: z.uuidv7() });

const NOT_A_SENDER =
  "Unter diesem Konto darf nicht gesendet werden. Freigeschaltet wird es vom Ur-Admin.";

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/broadcast/queue",
      tags: [MODERATION_TAG],
      summary: "Broadcasts waiting for an approval",
      description:
        "The oldest first, so nothing is left at the bottom — the same order the abuse reports have. The count of these is the red number on the moderation overview.",
      operationId: "listBroadcastQueue",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everything waiting",
          content: jsonContent(z.array(BROADCAST_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await BroadcastQueueService.listWaiting(), STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/broadcast/released",
      tags: [MODERATION_TAG],
      summary: "Broadcasts that have gone out",
      description:
        "The newest first, each with the account it went out as and — for the team's own eyes — who wrote it and who approved it.",
      operationId: "listReleasedBroadcasts",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "What was sent",
          content: jsonContent(z.array(BROADCAST_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await BroadcastQueueService.listReleased(), STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/broadcast/queue",
      tags: [MODERATION_TAG],
      summary: "Submit a broadcast for approval",
      description:
        "From the first administrator it is approved by the writing and goes out at once; from anybody else it waits for a second pair of eyes.",
      operationId: "submitBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(BROADCAST_BODY) },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "Waiting, or already gone out",
          content: jsonContent(BROADCAST_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "That account has not been released as a sender",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const written = await BroadcastQueueService.submit(
        c.get("user"),
        c.req.valid("json"),
      );

      return written === "sender_not_released"
        ? c.json({ error: NOT_A_SENDER }, STATUS_CODE.Forbidden)
        : c.json(written, STATUS_CODE.Created);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/broadcast/queue/{publicationId}/approval",
      tags: [MODERATION_TAG],
      summary: "Approve a waiting broadcast, which sends it",
      description:
        "Any administrator, but not the one who submitted it: a second pair of eyes is the whole point, and approving one's own would make the queue a formality. Approval and release are one act for now; the schedule arrives later.",
      operationId: "approveBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: publicationId },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Approved and on its way",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No broadcast has this id",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "It is not waiting for an approval",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "Nobody approves their own submission",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BroadcastQueueService.approve(
        c.req.valid("param").publicationId,
        c.get("user"),
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_waiting":
          return c.json(
            { error: "Diese Rundmail wartet nicht auf eine Freigabe." },
            STATUS_CODE.Conflict,
          );
        case "own_submission":
          return c.json(
            {
              error:
                "Deine eigene Einreichung kann jemand anderes aus der Administration freigeben.",
            },
            STATUS_CODE.Forbidden,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/broadcast/queue/{publicationId}",
      tags: [MODERATION_TAG],
      summary: "Change a broadcast, which takes back its approval",
      description:
        "Text, subject, audience and sender alike: an approval is about a whole message, and letting the harmless half be approved and the rest swapped afterwards would be the same as sending something else.",
      operationId: "editBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: publicationId,
        body: { required: true, content: jsonContent(BROADCAST_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Changed, and waiting for an approval again",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No broadcast has this id",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "It has already gone out",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "That account has not been released as a sender",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BroadcastQueueService.edit(
        c.req.valid("param").publicationId,
        c.req.valid("json"),
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_out":
          return c.json(
            {
              error:
                "Diese Rundmail ist verschickt. Was angekommen ist, lässt sich nicht mehr ändern.",
            },
            STATUS_CODE.Conflict,
          );
        case "sender_not_released":
          return c.json({ error: NOT_A_SENDER }, STATUS_CODE.Forbidden);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/broadcast/queue/{publicationId}",
      tags: [MODERATION_TAG],
      summary: "Discard a broadcast without sending it",
      description:
        "It stays as a trace rather than disappearing: what was submitted is part of what the queue says about the team's work.",
      operationId: "discardBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: publicationId },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Discarded",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No broadcast has this id",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "It has already gone out",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BroadcastQueueService.discard(
        c.req.valid("param").publicationId,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_out":
          return c.json(
            { error: "Diese Rundmail ist verschickt." },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  );
