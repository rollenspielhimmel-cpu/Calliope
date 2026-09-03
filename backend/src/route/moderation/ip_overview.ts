import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { EMAIL_ADDRESS_SCHEMA } from "@/src/http/request_schema.ts";
import {
  listQuerySchema,
  listResponseSchema,
} from "@/src/list/list_endpoint.ts";
import { listQuery } from "@/src/list/list_endpoint_query.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { IpModerationService } from "@/src/service/ip_moderation_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * The two lists behind the address tool's first and third tabs. The second — the bans themselves
 * — is `ip_bans.ts`, which already owned that route before there were tabs.
 *
 * Its own file rather than an addition to `ip_bans.ts`, and the two `query` routes are split
 * across it and there for the reason the forum's are: two of them chained onto one app leave the
 * second one's body typed `Record<string, unknown>`.
 *
 * **Email addresses are in both responses.** That is not a new disclosure — the pending-invitation
 * list has shown them to a moderator since it shipped — and it is the point of the second tab: a
 * banned address has to say *who* it reached, and two accounts sharing one are far easier to judge
 * with the addresses beside them.
 */

const SEEN_ACCOUNT = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  emailAddress: EMAIL_ADDRESS_SCHEMA,
});

const MEMBER_OVERVIEW_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  emailAddress: EMAIL_ADDRESS_SCHEMA,
  bannedAt: z.iso.datetime({ offset: true }).nullable(),
  ipAddresses: z.array(z.string()),
  possibleAlts: z.array(z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
  })),
});

const SHARED_ADDRESS_RESPONSE = z.object({
  id: z.string(),
  ipAddress: z.string(),
  accountCount: z.number().int(),
  accounts: z.array(SEEN_ACCOUNT),
});

// Sorting by anything but the name would need the address count as an output column, and the
// question this tab answers is "where is this member" — which is read alphabetically.
const OVERVIEW_SORT = USER_SCHEMA
  .keyof()
  .extract(["username", "createdAt"])
  .default("username");

// `{}` passed rather than omitted: the parameter defaults to `{} as Filters`, which leaves the
// generic unresolved and widens the whole body to `Record<string, unknown>` at the handler.
// The `search` field comes with `listQuerySchema`, already bounded and already `notBlank` —
// overwriting it with a hand-written one is what `request_schema_test.ts` caught.
const OVERVIEW_BODY = listQuerySchema(OVERVIEW_SORT, {}, "asc");

// Most-shared first by default: four accounts on one address is a different thing from two.
const SHARED_SORT = z
  .enum(["accountCount", "ipAddress"])
  .default("accountCount");

const SHARED_BODY = listQuerySchema(SHARED_SORT, {}, "desc");

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_OPERATOR_RESPONSE = {
  description: "Not an operator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "query",
      path: "/ip-overview",
      tags: [MODERATION_TAG],
      summary: "Every member with the addresses they have been seen from",
      description:
        "One row per member, including members with no session yet — the question is 'every member', and leaving those out would make it another one. `possibleAlts` names the other accounts sharing any of the same addresses, de-duplicated across them.",
      operationId: "listIpOverview",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        body: { required: true, content: jsonContent(OVERVIEW_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "A page of members",
          content: jsonContent(listResponseSchema(MEMBER_OVERVIEW_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await IpModerationService.listMemberIpOverview(
          listQuery(c.req.valid("json")),
        ),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "query",
      path: "/shared-ip-addresses",
      tags: [MODERATION_TAG],
      summary: "Addresses more than one account has been seen from",
      description:
        "The overview's question asked the other way round, and pre-filtered to the cases worth looking at. An address here is a reason to look, not a finding: a household, a school and a phone network behind CGNAT all put unrelated people on one address.",
      operationId: "listSharedIpAddresses",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        body: { required: true, content: jsonContent(SHARED_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "A page of shared addresses, most-shared first",
          content: jsonContent(listResponseSchema(SHARED_ADDRESS_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await IpModerationService.listSharedIpAddresses(
          listQuery(c.req.valid("json")),
        ),
        STATUS_CODE.OK,
      );
    },
  );
