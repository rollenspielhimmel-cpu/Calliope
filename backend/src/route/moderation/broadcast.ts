import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastService } from "@/src/service/broadcast_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Administrator only: writing to everybody at once is the platform speaking, not moderation
 * acting on one account.
 */

const BROADCAST_GROUP = z.enum(["administrator", "moderator", "member"]);

/**
 * At least one group, or the request asks for nothing. `member` is the ordinary account with no
 * platform role, which is almost everybody.
 */
const AUDIENCE = z.object({
  groups: z.array(BROADCAST_GROUP).min(1),
  includeUnverified: z.boolean().default(false),
});

const BROADCAST_BODY = z.object({
  audience: AUDIENCE,
  subject: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastSubject)),
  body: notBlank(z.string().min(1).max(TEXT_LIMIT.broadcastBody)),
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
      path: "/broadcast/recipients",
      tags: [MODERATION_TAG],
      summary: "Count who a broadcast would reach",
      description:
        "So the form can say how many before anybody presses send. A moment's truth rather than a promise: somebody may register in between.",
      operationId: "countBroadcastRecipients",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      // Flattened, because a query string carries no object: the groups arrive as one
      // comma-separated value rather than as a nested shape that would have to be encoded.
      request: {
        query: z.object({
          groups: z
            .string()
            .transform((value) => value.split(","))
            .pipe(z.array(BROADCAST_GROUP).min(1)),
          includeUnverified: z
            .enum(["true", "false"])
            .default("false")
            .transform((value) => value === "true"),
        }),
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "How many members that audience holds",
          content: jsonContent(z.object({ recipients: z.number().int() })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { groups, includeUnverified } = c.req.valid("query");
      const recipients = await BroadcastService.countRecipients({
        groups,
        includeUnverified,
      });
      return c.json({ recipients }, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/broadcast",
      tags: [MODERATION_TAG],
      summary: "Send one message to every member of an audience",
      description:
        "Text, not HTML, like every other message this platform sends. The audience is chosen by group — administrators, moderators, ordinary members — because most of what an operator says is addressed to the team or to everybody but the team. Banned accounts are always left out; unverified addresses unless the audience says otherwise. Answers as soon as the recipients are known — the sending itself happens in the background, so a slow relay cannot hold the request open.",
      operationId: "sendBroadcast",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(BROADCAST_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The messages are on their way",
          content: jsonContent(z.object({ recipients: z.number().int() })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { audience, subject, body } = c.req.valid("json");
      return c.json(
        await BroadcastService.send(audience, subject, body),
        STATUS_CODE.OK,
      );
    },
  );
