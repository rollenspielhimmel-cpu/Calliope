import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BlockedEmailDomainService } from "@/src/service/blocked_email_domain_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

// Administrator, not moderator, and the only routes under /moderation that are: this list
// decides who may register at all — the platform itself — rather than what happens to one
// account, which is the line the project already draws between the two roles. To let moderators
// keep it too, swap the guard on the three routes below and nothing else.

/**
 * A hostname, not an address, and no leading `@`. Kept deliberately loose about which labels
 * exist — new top-level domains appear all the time — while still refusing a whole address,
 * which is the mistake somebody actually makes here.
 */
const DOMAIN = z
  .string()
  .min(3)
  .max(TEXT_LIMIT.emailAddress)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
    "Gib nur die Domain an, etwa beispiel.de",
  );

const BLOCKED_DOMAIN_RESPONSE = z.object({
  domain: z.string(),
  addedBy: z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
  }).nullable(),
  addedAt: z.iso.datetime({ offset: true }),
  note: z.string().nullable(),
});

const BLOCK_DOMAIN_BODY = z.object({
  domain: DOMAIN,
  // Optional, unlike a ban's reason: the entry usually explains itself.
  note: notBlank(z.string().min(1).max(TEXT_LIMIT.banReason)).optional(),
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
      path: "/blocked-email-domains",
      tags: [MODERATION_TAG],
      summary: "List every email domain blocked from registering",
      operationId: "listBlockedEmailDomains",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every blocked domain, alphabetically",
          content: jsonContent(z.array(BLOCKED_DOMAIN_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlockedEmailDomainService.listBlocked(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blocked-email-domains",
      tags: [MODERATION_TAG],
      summary: "Block an email domain from registering",
      description:
        "Matched exactly, never as a suffix: blocking `mail.com` would otherwise take `gmail.com` with it. Blocking one already on the list updates its note.",
      operationId: "blockEmailDomain",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(BLOCK_DOMAIN_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The domain is blocked",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { domain, note } = c.req.valid("json");
      await BlockedEmailDomainService.addBlocked(
        domain,
        c.get("user").id,
        note,
      );
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/blocked-email-domains/{domain}",
      tags: [MODERATION_TAG],
      summary: "Allow an email domain to register again",
      operationId: "unblockEmailDomain",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ domain: DOMAIN }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The domain may register again, or was never blocked",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { domain } = c.req.valid("param");
      await BlockedEmailDomainService.removeBlocked(domain);
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
