import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import {
  authorizedAsAdministrator,
  authorizedToPreparePublications,
} from "@/src/middleware/authorized_as_platform_role.ts";
import {
  OfficialThreadService,
  type ThreadRefusal,
} from "@/src/service/official_thread_service.ts";
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
 * Offizielle Forum-Threads: einreichen, freigeben, bearbeiten, verwerfen, nachsehen. Dieselben
 * Regeln wie bei Rundmails; was gilt und warum, steht in `official_thread_service.ts`.
 */

const THREAD_BODY = z.object({
  title: notBlank(z.string().min(1).max(TEXT_LIMIT.threadTitle)),
  /** Der Eröffnungsbeitrag als reiner Text. */
  text: notBlank(z.string().min(1).max(TEXT_LIMIT.documentText)),
  /** Null ist die oberste Ebene des Forums. */
  folderId: z.uuidv7().nullable(),
  /** Null heißt „Admin", das Konto der Plattform. */
  sendAsUserId: z.uuidv7().nullable(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
  /** Nur die Administration sieht den Eintrag in der Warteschlange; setzen darf das nur sie. */
  administrationOnly: z.boolean().default(false),
});

const THREAD_RESPONSE = THREAD_BODY.extend({
  publicationId: z.uuidv7(),
  threadId: z.uuidv7(),
  status: z.enum([
    "draft",
    "awaiting_approval",
    "approved",
    "released",
    "discarded",
  ]),
  folderTitle: z.string().nullable(),
  sendAsUsername: z.string().nullable(),
  /** Intern: wer ihn geschrieben hat. Sichtbar nur, wem der Eintrag gezeigt wird. */
  writtenBy: z.uuidv7().nullable(),
  writtenByUsername: z.string().nullable(),
  writtenAt: z.iso.datetime({ offset: true }),
  approvedByUsername: z.string().nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  editedByUsername: z.string().nullable(),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
  releasedAt: z.iso.datetime({ offset: true }).nullable(),
});

const PARAMS = z.object({ publicationId: z.uuidv7() });

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const REFUSED = {
  description:
    "The sender is not the writer's to use, the administration-only mark is not theirs to change, or it is somebody else's entry",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const PLACE_REFUSED = {
  description: "No such forum folder, or members cannot see it",
  content: jsonContent(ERROR_RESPONSE),
} as const;

/** Die Sätze zu den Absagen, die Einreichen und Bearbeiten teilen. */
function refusalOf(refusal: ThreadRefusal): {
  error: string;
  status: 403 | 404 | 409;
} {
  switch (refusal) {
    case "sender_not_released":
      return {
        error: "Unter diesem Absender darfst du nicht vorbereiten.",
        status: STATUS_CODE.Forbidden,
      };
    case "administration_only_is_theirs":
      return {
        error:
          "Ob nur die Administration einen Eintrag sieht, legt die Administration fest.",
        status: STATUS_CODE.Forbidden,
      };
    case "folder_not_available":
      return {
        error:
          "Dieses Unterforum gibt es nicht, oder Mitglieder sehen es nicht.",
        status: STATUS_CODE.NotFound,
      };
    case "no_administration_account":
      return {
        error:
          "Das Konto der Plattform gibt es gerade nicht, also auch den Absender „Admin“ nicht.",
        status: STATUS_CODE.Conflict,
      };
    default:
      return assertUnreachable(refusal);
  }
}

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/official-threads/queue",
      tags: [MODERATION_TAG],
      summary: "Official threads waiting for approval or for their time",
      description:
        "What the viewer may see of it — the same rule as the broadcast queue.",
      operationId: "listOfficialThreadQueue",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everything waiting",
          content: jsonContent(z.array(THREAD_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await OfficialThreadService.listWaiting(c.get("user")),
        STATUS_CODE.OK,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/official-threads/released",
      tags: [MODERATION_TAG],
      summary: "Official threads that have appeared",
      description:
        "What the viewer may see of it — the same rule as the broadcast queue.",
      operationId: "listReleasedOfficialThreads",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "What appeared",
          content: jsonContent(z.array(THREAD_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await OfficialThreadService.listReleased(c.get("user")),
        STATUS_CODE.OK,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/official-threads",
      tags: [MODERATION_TAG],
      summary: "Submit an official forum thread",
      description:
        "Title, folder and opening post at once. From an administrator it is approved by the writing and, without a schedule, appears at once; from anybody else it waits for an administrator. Until it appears it is in no forum view, for nobody.",
      operationId: "submitOfficialThread",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      request: { body: { required: true, content: jsonContent(THREAD_BODY) } },
      responses: {
        [STATUS_CODE.Created]: {
          description: "Waiting, scheduled, or already visible",
          content: jsonContent(THREAD_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: REFUSED,
        [STATUS_CODE.NotFound]: PLACE_REFUSED,
        [STATUS_CODE.Conflict]: {
          description: "There is no platform account to appear as",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const written = await OfficialThreadService.submit(
        c.get("user"),
        c.req.valid("json"),
      );

      if (typeof written !== "string") {
        return c.json(written, STATUS_CODE.Created);
      }

      const { error, status } = refusalOf(written);
      return c.json({ error }, status);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/official-threads/{publicationId}",
      tags: [MODERATION_TAG],
      summary: "Change an official thread before it appears",
      description:
        "From a role without administration it waits again, and that role may change only its own; from an administrator the new version is approved by the saving and, without a schedule, appears at once.",
      operationId: "editOfficialThread",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      request: {
        params: PARAMS,
        body: { required: true, content: jsonContent(THREAD_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The entry as it now stands",
          content: jsonContent(THREAD_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: REFUSED,
        [STATUS_CODE.NotFound]: PLACE_REFUSED,
        [STATUS_CODE.Conflict]: {
          description:
            "It has already appeared, or there is no platform account to appear as",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const edited = await OfficialThreadService.edit(
        c.req.valid("param").publicationId,
        c.req.valid("json"),
        c.get("user"),
      );

      if (typeof edited !== "string") {
        return c.json(edited, STATUS_CODE.OK);
      }

      switch (edited) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_out":
          return c.json(
            {
              error:
                "Dieser Thread ist schon erschienen. Ändern kann ihn nur noch die Administration, im Forum.",
            },
            STATUS_CODE.Conflict,
          );
        case "not_yours":
          return c.json(
            {
              error:
                "Diesen Thread hat jemand anderes eingereicht. Ändern oder verwerfen kann ihn die Administration.",
            },
            STATUS_CODE.Forbidden,
          );
        default: {
          const { error, status } = refusalOf(edited);
          return c.json({ error }, status);
        }
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/official-threads/{publicationId}",
      tags: [MODERATION_TAG],
      summary: "Discard an official thread before it appears",
      description:
        "It stays as a trace and never appears. Without administration, only one's own.",
      operationId: "discardOfficialThread",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      request: { params: PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Discarded",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such entry",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "It has already appeared",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "It is somebody else's",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await OfficialThreadService.discard(
        c.req.valid("param").publicationId,
        c.get("user"),
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_out":
          return c.json(
            { error: "Dieser Thread ist schon erschienen." },
            STATUS_CODE.Conflict,
          );
        case "not_yours":
          return c.json(
            {
              error:
                "Diesen Thread hat jemand anderes eingereicht. Verwerfen kann ihn die Administration.",
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
      method: "post",
      path: "/official-threads/{publicationId}/approval",
      tags: [MODERATION_TAG],
      summary: "Approve an official thread, which makes it appear",
      description:
        "Administrators only. Without a schedule it appears at once; with one, the clock makes it appear.",
      operationId: "approveOfficialThread",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Approved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such entry",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "It is not waiting for an approval",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await OfficialThreadService.approve(
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
            { error: "Dieser Thread wartet nicht auf eine Freigabe." },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  );
