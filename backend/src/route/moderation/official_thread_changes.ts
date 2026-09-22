import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import {
  authorizedAsAdministrator,
  authorizedToPreparePublications,
} from "@/src/middleware/authorized_as_platform_role.ts";
import { OfficialThreadService } from "@/src/service/official_thread_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Was an offiziellen Threads nach dem Einreichen geschieht: einen bestehenden Thread offiziell
 * machen, die Überschrift eines erschienenen ändern, und das Protokoll lesen. Das Ändern und
 * Löschen offizieller Beiträge geht über die Forum-Routen selbst, mit einem Grund.
 */

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

/** Ein Grund, ohne den eine freigegebene Aussage nicht geändert wird. */
export const REVISION_REASON = notBlank(
  z.string().min(1).max(TEXT_LIMIT.officialRevisionReason),
);

const EXISTING_BODY = z.object({
  threadId: z.uuidv7(),
  /** Null heißt „Admin", das Konto der Plattform. */
  sendAsUserId: z.uuidv7().nullable(),
  administrationOnly: z.boolean().default(false),
});

const EXISTING_RESPONSE = z.object({
  publicationId: z.uuidv7(),
  threadId: z.uuidv7(),
  status: z.enum([
    "draft",
    "awaiting_approval",
    "approved",
    "released",
    "discarded",
  ]),
});

const REVISION_RESPONSE = z.object({
  id: z.uuidv7(),
  kind: z.enum(["title_changed", "post_edited", "post_deleted"]),
  editedByUsername: z.string().nullable(),
  editedAt: z.iso.datetime({ offset: true }),
  reason: z.string(),
  titleBefore: z.string().nullable(),
  titleAfter: z.string().nullable(),
  textBefore: z.string().nullable(),
  textAfter: z.string().nullable(),
});

const THREAD_PARAMS = z.object({ threadId: z.uuidv7() });

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "post",
      path: "/official-threads/existing",
      tags: [MODERATION_TAG],
      summary: "Make a thread that is already in the forum official",
      description:
        "The opener or an administrator, and only where the opening post is by somebody on the team. Swaps the name on the opening post once approved; title and text do not change. From an administrator it is approved at once.",
      operationId: "submitExistingOfficialThread",
      middleware: [authenticated, authorizedToPreparePublications] as const,
      request: {
        body: { required: true, content: jsonContent(EXISTING_BODY) },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "Waiting, or already official",
          content: jsonContent(EXISTING_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description:
            "Not the opener, the opening post is not by the team, or the sender or mark is not theirs",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such forum thread",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Already official, or already waiting to become so",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const outcome = await OfficialThreadService.submitForExisting(
        c.get("user"),
        c.req.valid("json"),
      );

      if (typeof outcome !== "string") {
        return c.json({
          publicationId: outcome.publicationId,
          threadId: outcome.threadId,
          status: outcome.status,
        }, STATUS_CODE.Created);
      }

      switch (outcome) {
        case "thread_not_found":
        case "folder_not_available":
          return c.json(
            { error: "Diesen Thread gibt es im Forum nicht." },
            STATUS_CODE.NotFound,
          );
        case "not_the_opener":
          return c.json(
            {
              error:
                "Offiziell machen kann einen Thread nur, wer ihn eröffnet hat, oder die Administration.",
            },
            STATUS_CODE.Forbidden,
          );
        case "opening_post_not_by_team":
          return c.json(
            {
              error:
                "Der Eröffnungsbeitrag stammt nicht von jemandem aus dem Team. Einem Mitglied lassen sich keine Worte als offizielle Aussage unterschieben.",
            },
            STATUS_CODE.Forbidden,
          );
        case "sender_not_released":
          return c.json(
            { error: "Unter diesem Absender darfst du nicht vorbereiten." },
            STATUS_CODE.Forbidden,
          );
        case "administration_only_is_theirs":
          return c.json(
            {
              error:
                "Ob nur die Administration einen Eintrag sieht, legt die Administration fest.",
            },
            STATUS_CODE.Forbidden,
          );
        case "already_official":
          return c.json(
            { error: "Dieser Thread ist schon offiziell." },
            STATUS_CODE.Conflict,
          );
        case "already_pending":
          return c.json(
            {
              error:
                "Für diesen Thread wartet schon eine Einreichung in der Warteschlange.",
            },
            STATUS_CODE.Conflict,
          );
        case "no_administration_account":
          return c.json(
            {
              error:
                "Das Konto der Plattform gibt es gerade nicht, also auch den Absender „Admin“ nicht.",
            },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(outcome);
      }
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/official-threads/threads/{threadId}/title",
      tags: [MODERATION_TAG],
      summary: "Change the title of an official thread",
      description:
        "Administrators only, with a reason. The protocol keeps who, when, why, and the title before and after.",
      operationId: "changeOfficialThreadTitle",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: THREAD_PARAMS,
        body: {
          required: true,
          content: jsonContent(z.object({
            title: notBlank(z.string().min(1).max(TEXT_LIMIT.threadTitle)),
            reason: REVISION_REASON,
          })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Changed",
          content: jsonContent(z.object({ title: z.string() })),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such thread in the forum",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Not an official thread, or the title is the same",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { title, reason } = c.req.valid("json");
      const outcome = await OfficialThreadService.changeTitle(
        c.req.valid("param").threadId,
        title,
        reason,
        c.get("user"),
      );

      if (typeof outcome !== "string") {
        return c.json(outcome, STATUS_CODE.OK);
      }

      switch (outcome) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_official":
          return c.json(
            {
              error:
                "Das ist kein offizieller Thread. Seine Überschrift ändert, wer ihn eröffnet hat.",
            },
            STATUS_CODE.Conflict,
          );
        case "unchanged":
          return c.json(
            { error: "Die Überschrift ist dieselbe." },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(outcome);
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/official-threads/threads/{threadId}/revisions",
      tags: [MODERATION_TAG],
      summary: "The change protocol of an official thread",
      description:
        "Administrators only. Every change to the title and to official posts after the thread appeared, newest first — who, when, why, before and after.",
      operationId: "listOfficialThreadRevisions",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: THREAD_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The protocol",
          content: jsonContent(z.array(REVISION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await OfficialThreadService.listRevisions(
          c.req.valid("param").threadId,
        ),
        STATUS_CODE.OK,
      ),
  );
