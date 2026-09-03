import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { IpModerationService } from "@/src/service/ip_moderation_service.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

const IP_ADDRESS_ENTRY_RESPONSE = z.object({
  ipAddress: z.string(),
  firstSeenAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  // Non-empty means at least one other account has been seen from the same address.
  sharedWith: z.array(
    z.object({
      id: USER_SCHEMA.shape.id,
      username: USER_SCHEMA.shape.username,
    }),
  ),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/{userId}/ip-addresses",
    tags: [MODERATION_TAG],
    summary: "List a member's IP addresses, with shared accounts flagged",
    description:
      "Every address this member has connected from, newest first, and for each one which other accounts have also used it. An empty `sharedWith` means nothing to flag. Addresses are shared often enough — a household, a phone network — that this is evidence to read rather than a verdict.",
    operationId: "listIpAddressesForMember",
    middleware: [authenticated, authorizedAsModerator] as const,
    request: { params: z.object({ userId: USER_SCHEMA.shape.id }) },
    responses: {
      [STATUS_CODE.OK]: {
        description: "This member's IP addresses",
        content: jsonContent(z.array(IP_ADDRESS_ENTRY_RESPONSE)),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Not an operator",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { userId } = c.req.valid("param");
    const entries = await IpModerationService.listIpAddressesForUser(userId);
    return c.json(entries, STATUS_CODE.OK);
  },
);
