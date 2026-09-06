import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { AdminInboxService } from "@/src/service/admin_inbox_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Das Postfach der Administration.
 *
 * **Der eine Ort für alles, was an sie gerichtet ist**, damit nichts untergeht — bisher musste man
 * Rundmail für Rundmail nachsehen, ob jemand geantwortet hat. Warum es ein Ort und keine Ableitung
 * aus der Mitgliedschaft ist, steht in `admin_inbox_service.ts`.
 *
 * **Nur die Administration**, lesen wie schreiben. Wer der Administration schreibt, weiß, an
 * welchen Kreis er sich wendet, und rechnet nicht damit, dass die Moderation mitliest.
 */

const CONVERSATION = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  excerpt: z.string(),
  lastMessageAt: z.iso.datetime({ offset: true }),
  awaitingReply: z.boolean(),
  broadcastId: z.uuidv7().nullable(),
});

const MESSAGE = z.object({
  id: z.uuidv7(),
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  username: z.string().nullable(),
  fromTeam: z.boolean(),
  // Die Rundmail selbst, nicht eine Antwort darauf. Ohne das liest sich der Verlauf falsch herum.
  isAnnouncement: z.boolean(),
  writtenByUsername: z.string().nullable(),
});

const CONVERSATION_DETAIL = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  broadcastId: z.uuidv7().nullable(),
  messages: z.array(MESSAGE),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_ADMINISTRATOR_RESPONSE = {
  description: "Not an administrator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/inbox",
      tags: [MODERATION_TAG],
      summary: "Everything addressed to the administration",
      description:
        "Conversations a member has actually written in, their newest message first. A broadcast gives every recipient a conversation — that is the delivery — so listing all of them would show the audience again and hide the real messages inside it.",
      operationId: "listAdminInbox",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The conversations",
          content: jsonContent(z.object({ results: z.array(CONVERSATION) })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        { results: await AdminInboxService.listConversations() },
        STATUS_CODE.OK,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/inbox/{chatGroupId}",
      tags: [MODERATION_TAG],
      summary: "Read one conversation from the inbox",
      description:
        "Refuses anything not addressed to the administration: without that check this would be an id with which an administrator could open any conversation on the platform, private chats included.",
      operationId: "readAdminInboxConversation",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ chatGroupId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The conversation",
          content: jsonContent(CONVERSATION_DETAIL),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such conversation in the inbox",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { chatGroupId } = c.req.valid("param");

      const conversation = await AdminInboxService.readConversation(
        chatGroupId,
      );

      return conversation === undefined
        ? c.json(
          { error: "Dieses Gespräch liegt nicht im Postfach." },
          STATUS_CODE.NotFound,
        )
        : c.json(conversation, STATUS_CODE.OK);
    },
  );
