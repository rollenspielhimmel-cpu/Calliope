import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT, TEXT_MINIMUM } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Which accounts a broadcast may be sent as, released and withdrawn.
 *
 * **Reading and changing are not equally restricted here**, unlike the Blind-Date desk next door.
 * Every administrator has to read this list — it is what they pick a sender from when they write a
 * mail — while only the root administrator may change it. Restricting the reading too would mean
 * nobody but one person could compose anything.
 *
 * The change is checked in the handler rather than by a middleware, for the reason the Blind-Date
 * grant gives: the middleware vocabulary is roles, and this sits one level above them.
 */

const SENDER_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  /**
   * True for the root administrator. It is in the list by being that account rather than by a row,
   * so the interface shows it without a switch — a switch that refuses every press is worse than
   * no switch.
   */
  isPermanent: z.boolean(),
});

const NOT_THE_ROOT_ADMIN = {
  description: "Only the first administrator may change this",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/broadcast/senders",
      tags: [MODERATION_TAG],
      summary: "Which accounts a broadcast may be sent as",
      description:
        "The first administrator, which is always available, followed by every released account in the order they are offered. Readable by every administrator, because this is the list a broadcast's sender is chosen from.",
      operationId: "listBroadcastSenders",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The accounts available as senders",
          content: jsonContent(z.array(SENDER_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await BroadcastSenderService.listSenders(), STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/broadcast/senders",
      tags: [MODERATION_TAG],
      summary: "Release an account as a sender",
      description:
        "Only the first administrator, and by the name the account goes by rather than by its id: there is no way to look an account up, and the person doing this knows which persona they mean. Any account may be released, including one nobody signs in as — not the first administrator itself, which is available permanently.",
      operationId: "releaseBroadcastSender",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: {
          required: true,
          content: jsonContent(
            z.object({
              // The same bound the registration puts on a name: this field holds one, and a
              // field that accepts more than can exist would refuse only after the round trip.
              username: notBlank(
                USER_SCHEMA.shape.username
                  .min(TEXT_MINIMUM.username)
                  .max(TEXT_LIMIT.username),
              ),
            }),
          ),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The account is released",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No account goes by this name",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const user = c.get("user");

      if (!user.isPrimordialAdmin) {
        return c.json(
          { error: "Only the first administrator may change this" },
          STATUS_CODE.Forbidden,
        );
      }

      const refusal = await BroadcastSenderService.releaseSender(
        c.req.valid("json").username,
        user.id,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json(
            { error: "Unter diesem Namen gibt es kein Konto." },
            STATUS_CODE.NotFound,
          );
        case "is_root_administrator":
          return c.json(
            {
              error:
                "Dieses Konto steht ohnehin dauerhaft zur Verfügung und muss nicht freigeschaltet werden.",
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
      method: "delete",
      path: "/broadcast/senders/{userId}",
      tags: [MODERATION_TAG],
      summary: "Withdraw a released sender",
      description:
        "Only the first administrator. What was already sent under that name is untouched: the sender is recorded on the publication itself, not read back from this list.",
      operationId: "withdrawBroadcastSender",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ userId: USER_SCHEMA.shape.id }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The release is withdrawn",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      if (!c.get("user").isPrimordialAdmin) {
        return c.json(
          { error: "Only the first administrator may change this" },
          STATUS_CODE.Forbidden,
        );
      }

      const refusal = await BroadcastSenderService.withdrawSender(
        c.req.valid("param").userId,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "is_root_administrator":
          return c.json(
            {
              error:
                "Dieses Konto steht dauerhaft zur Verfügung und kann nicht entzogen werden.",
            },
            STATUS_CODE.Forbidden,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  );
