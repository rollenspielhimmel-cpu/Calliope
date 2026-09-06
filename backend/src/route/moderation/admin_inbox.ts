import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { AdminInboxService } from "@/src/service/admin_inbox_service.ts";
import { publishChatEvent } from "@/src/event/chat_events.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
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
 * Rundmail für Rundmail nachsehen, ob jemand geantwortet hat. Wie die Fäden geschnitten sind und
 * warum je Mitglied *und* Absender, steht in `admin_inbox_service.ts`.
 *
 * **Nur die Administration**, lesen wie schreiben.
 *
 * Hier stand einmal das Gegenteil: Die ganze Moderation dürfe lesen, weil sehen muss, was auf eine
 * Ankündigung zurückkommt, wer beobachtet, wie es der Community geht. Der Satz klingt richtig und
 * übersieht, an wen das Mitglied geschrieben hat. Mitglieder wissen, wer die Administration ist,
 * und rechnen nicht damit, dass die Moderation mitliest — bei einer Beschwerde über eine
 * Moderatorin ist das nicht bloß unangenehm, sondern genau der Grund, aus dem sie an die
 * Administration ging.
 *
 * Ein Weg bleibt: Meldet das Mitglied selbst eine Nachricht, hält `report` einen Auszug fest, den
 * die Moderation liest. Das ist Absicht — dort hat das Mitglied es aus der Hand gegeben.
 */

const CONVERSATION = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  senderUsername: z.string().nullable(),
  excerpt: z.string(),
  lastMessageAt: z.iso.datetime({ offset: true }),
  awaitingReply: z.boolean(),
});

const MESSAGE = z.object({
  id: z.uuidv7(),
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  username: z.string().nullable(),
  fromTeam: z.boolean(),
  // Eine Rundmail, keine Antwort darauf. Ohne das liest sich der Verlauf falsch herum.
  isAnnouncement: z.boolean(),
  subject: z.string().nullable(),
  writtenByUsername: z.string().nullable(),
});

const CONVERSATION_DETAIL = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  senderUsername: z.string().nullable(),
  messages: z.array(MESSAGE),
});

const REPLY_BODY = z.object({
  text: notBlank(z.string().min(1).max(TEXT_LIMIT.messageText)),
});

/**
 * Dieselbe Auskunft für „gibt es nicht" und „gehört nicht hierher".
 *
 * Zwei verschiedene Sätze wären eine Auskunft darüber, welche Kennungen es gibt — und die Route
 * nimmt eine Gesprächskennung von jemandem entgegen, der sie nicht selbst gesehen haben muss.
 */
const NOT_IN_THE_INBOX = "Dieses Gespräch liegt nicht im Postfach.";

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
        ? c.json({ error: NOT_IN_THE_INBOX }, STATUS_CODE.NotFound)
        : c.json(conversation, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/inbox/{chatGroupId}",
      tags: [MODERATION_TAG],
      summary: "Reply in a conversation from the inbox",
      description:
        "The reply goes out under the name the conversation runs as, read from the conversation rather than chosen per message. Stored with who actually wrote it: the member never sees that, the administration does.",
      operationId: "replyInAdminInbox",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ chatGroupId: z.uuidv7() }),
        body: { required: true, content: jsonContent(REPLY_BODY) },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "The reply, as the team reads it",
          content: jsonContent(MESSAGE),
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
      const { text } = c.req.valid("json");
      const writer = c.get("user");

      const result = await AdminInboxService.reply(
        chatGroupId,
        text,
        writer.id,
      );

      if (!result.ok) {
        return c.json({ error: NOT_IN_THE_INBOX }, STATUS_CODE.NotFound);
      }

      // Nach dem Schreiben, nie darin: Ein Strom, in den sich nicht schreiben lässt, darf keine
      // Nachricht umwerfen, die schon steht. Im Gespräch sitzt nur das Mitglied — der Absender
      // gehört nicht hinein, und wer getippt hat, hat die Antwort in der Antwort.
      publishChatEvent(result.memberIds, {
        chatGroupId,
        message: result.message,
      });

      return c.json({
        id: result.message.id,
        text: result.message.text,
        createdAt: result.message.createdAt,
        username: result.message.createdByUsername,
        fromTeam: true,
        // Eine Antwort, nie eine Ankündigung.
        isAnnouncement: false,
        subject: null,
        writtenByUsername: writer.username,
      }, STATUS_CODE.Created);
    },
  );
