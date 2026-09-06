import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastReplyService } from "@/src/service/broadcast_reply_service.ts";
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
 * Was auf eine Rundmail geantwortet wurde.
 *
 * **Nur die Administration, lesen wie schreiben.**
 *
 * Hier stand einmal das Gegenteil: die ganze Moderation dürfe lesen, weil sehen muss, was auf eine
 * Ankündigung zurückkommt, wer beobachtet, wie es der Community geht. Der Satz klingt richtig und
 * übersieht, an wen das Mitglied geschrieben hat.
 *
 * Mitglieder wissen, wer die Administration ist. Wer ihr schreibt, weiß also, an welchen Kreis er
 * sich wendet — und rechnet nicht damit, dass die Moderation mitliest. Bei einer Beschwerde über
 * eine Moderatorin ist das nicht bloß unangenehm, sondern genau der Grund, aus dem sie an die
 * Administration ging. Ein Rundmail-Gespräch ist derselbe Kanal wie eine direkte Nachricht an die
 * Administration; die Regel muss deshalb dieselbe sein.
 *
 * Ein Weg bleibt: Meldet das Mitglied selbst eine Nachricht, hält `report` einen Auszug fest, den
 * die Moderation liest. Das ist Absicht — dort hat das Mitglied es aus der Hand gegeben.
 *
 * Warum die Antworten nicht in einem Postfach landen und wie ein Gespräch aufgebaut ist, steht in
 * `broadcast_reply_service.ts`.
 */

const REPLY = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  lastReplyAt: z.iso.datetime({ offset: true }),
  excerpt: z.string(),
});

const MESSAGE = z.object({
  id: z.uuidv7(),
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  username: z.string().nullable(),
  fromTeam: z.boolean(),
  // Die Rundmail selbst, nicht eine Antwort darauf. Ohne das liest sich der Verlauf falsch herum.
  isAnnouncement: z.boolean(),
  // Leer bei allem außer den Antworten der Administration — siehe `broadcast_reply_service.ts`.
  writtenByUsername: z.string().nullable(),
});

const CONVERSATION = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  messages: z.array(MESSAGE),
});

const REPLY_BODY = z.object({
  text: notBlank(z.string().min(1).max(TEXT_LIMIT.messageText)),
});

/**
 * Dieselbe Auskunft für „gibt es nicht" und „gehört nicht hierher".
 *
 * Zwei verschiedene Sätze wären eine Auskunft darüber, welche Kennungen es gibt — und die
 * Antwort-Route nimmt eine Gesprächskennung von jemandem entgegen, der sie nicht selbst gesehen
 * haben muss.
 */
const NOT_THIS_BROADCAST = "Dieses Gespräch gehört nicht zu dieser Rundmail.";

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
      path: "/broadcast/{broadcastId}/replies",
      tags: [MODERATION_TAG],
      summary: "Who replied to a broadcast",
      description:
        "Administrator only: a member writing to the administration does not expect the moderation to read along. Only conversations a member actually wrote in, their newest message first — every recipient has a conversation, that is the delivery, so listing all of them would show the audience again and hide the replies inside it.",
      operationId: "listBroadcastReplies",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ broadcastId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The replies",
          content: jsonContent(z.object({ results: z.array(REPLY) })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { broadcastId } = c.req.valid("param");

      return c.json(
        { results: await BroadcastReplyService.listReplies(broadcastId) },
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/broadcast/{broadcastId}/replies/{chatGroupId}",
      tags: [MODERATION_TAG],
      summary: "Read one reply conversation",
      description:
        "The broadcast is part of the address, not decoration: without it this would be an id with which anybody on the team could open any conversation on the platform, private chats included.",
      operationId: "readBroadcastConversation",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({
          broadcastId: z.uuidv7(),
          chatGroupId: z.uuidv7(),
        }),
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The conversation",
          content: jsonContent(CONVERSATION),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such conversation for this broadcast",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { broadcastId, chatGroupId } = c.req.valid("param");

      const conversation = await BroadcastReplyService.readConversation(
        broadcastId,
        chatGroupId,
      );

      return conversation === undefined
        ? c.json(
          { error: NOT_THIS_BROADCAST },
          STATUS_CODE.NotFound,
        )
        : c.json(conversation, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/broadcast/{broadcastId}/replies/{chatGroupId}",
      tags: [MODERATION_TAG],
      summary: "Reply in a broadcast conversation",
      description:
        "A reply goes out under the sender the broadcast ran as. Stored with who actually wrote it: the member never sees that, the administration does.",
      operationId: "replyToBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({
          broadcastId: z.uuidv7(),
          chatGroupId: z.uuidv7(),
        }),
        body: { required: true, content: jsonContent(REPLY_BODY) },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "The reply, as the team reads it",
          content: jsonContent(MESSAGE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such conversation for this broadcast",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { broadcastId, chatGroupId } = c.req.valid("param");
      const { text } = c.req.valid("json");
      const writer = c.get("user");

      const result = await BroadcastReplyService.reply(
        broadcastId,
        chatGroupId,
        text,
        writer.id,
      );

      if (!result.ok) {
        return c.json({ error: NOT_THIS_BROADCAST }, STATUS_CODE.NotFound);
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
        // Eine Antwort, nie die Rundmail selbst.
        isAnnouncement: false,
        writtenByUsername: writer.username,
      }, STATUS_CODE.Created);
    },
  );
