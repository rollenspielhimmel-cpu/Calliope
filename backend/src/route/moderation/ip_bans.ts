import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { EMAIL_ADDRESS_SCHEMA } from "@/src/http/request_schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { IpModerationService } from "@/src/service/ip_moderation_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Validated rather than taken as text: the column is `inet`, so anything else reaches Postgres
 * and comes back as a 500 instead of the 400 it actually is.
 */
const IP_ADDRESS = z.union([z.ipv4(), z.ipv6()]);

const BANNED_IP_RESPONSE = z.object({
  ipAddress: z.string(),
  bannedAt: z.iso.datetime({ offset: true }),
  bannedBy: z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
  }).nullable(),
  reason: z.string(),
  /**
   * Who was ever seen from this address. An address is banned rather than an account, so without
   * this the list cannot say who a ban originally reached. Empty is a real answer: an address may
   * be banned that no account here has ever used.
   */
  accounts: z.array(z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
    emailAddress: EMAIL_ADDRESS_SCHEMA,
  })),
});

const BAN_IP_BODY = z.object({
  ipAddress: IP_ADDRESS,
  // Same bound as an account ban's: one incident, not an essay.
  reason: notBlank(z.string().min(1).max(TEXT_LIMIT.banReason)),
});

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/ip-bans",
      tags: [MODERATION_TAG],
      summary: "List every currently banned IP address",
      operationId: "listBannedIps",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every banned IP address, newest first",
          content: jsonContent(z.array(BANNED_IP_RESPONSE)),
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
      const bans = await IpModerationService.listBannedIps();
      return c.json(bans, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/ip-bans",
      tags: [MODERATION_TAG],
      summary: "Ban an IP address",
      description:
        "Refuses every request from this address from now on, independent of any account. Deliberately not tied to banning an account: an address can belong to a household or a phone network, so the two are decided separately.",
      operationId: "banIpAddress",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        body: { required: true, content: jsonContent(BAN_IP_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The address is banned",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: {
          description: "No valid session",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "Not an operator",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { ipAddress, reason } = c.req.valid("json");
      await IpModerationService.banIp(ipAddress, c.get("user").id, reason);
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/ip-bans/{ipAddress}",
      tags: [MODERATION_TAG],
      summary: "Lift an IP ban",
      operationId: "unbanIpAddress",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ ipAddress: IP_ADDRESS }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The ban is lifted, or there was none",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: {
          description: "No valid session",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: {
          description: "Not an operator",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { ipAddress } = c.req.valid("param");
      await IpModerationService.unbanIp(ipAddress);
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
