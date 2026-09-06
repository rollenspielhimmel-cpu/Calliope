import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import {
  authorizedAsAdministrator,
  authorizedAsModerator,
} from "@/src/middleware/authorized_as_platform_role.ts";
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
 * **Die ganze Moderation darf lesen**, anders als beim Rest des Rundmail-Bereichs, der der
 * Administration vorbehalten ist. Wer beobachtet, wie es der Community geht, muss sehen, was auf
 * eine Ankündigung zurückkommt — und das Antworten selbst bleibt trotzdem der Administration.
 *
 * Warum die Antworten nicht in einem Postfach landen und wie ein Gespräch aufgebaut ist, steht in
 * `broadcast_reply_service.ts`.
 */

const REPLY = z.object({
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  lastActivityAt: z.iso.datetime({ offset: true }),
  excerpt: z.string(),
});

const MESSAGE = z.object({
  id: z.uuidv7(),
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  username: z.string().nullable(),
  fromTeam: z.boolean(),
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

const NOT_AN_OPERATOR_RESPONSE = {
  description: "Not on the team",
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
        "Only conversations a member actually wrote in, newest activity first. Every recipient has a conversation — that is the delivery — so listing all of them would show the audience again and hide the replies inside it.",
      operationId: "listBroadcastReplies",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ broadcastId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The replies",
          content: jsonContent(z.object({ results: z.array(REPLY) })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
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
      middleware: [authenticated, authorizedAsModerator] as const,
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
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
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
        "Administrator only, unlike reading: a reply goes out under the sender the broadcast ran as, and speaking as the platform is not the same as watching what comes back. Stored with who actually wrote it; the member never sees that.",
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

      const result = await BroadcastReplyService.reply(
        broadcastId,
        chatGroupId,
        text,
        c.get("user").id,
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
      }, STATUS_CODE.Created);
    },
  );
