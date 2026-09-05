import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
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
  );
