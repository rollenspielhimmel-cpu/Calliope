import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { EMAIL_ADDRESS_SCHEMA } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { InvitationService } from "@/src/service/invitation_service.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

const MEMBER = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
});

const PENDING_INVITATION_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  emailAddress: EMAIL_ADDRESS_SCHEMA,
  createdAt: z.iso.datetime({ offset: true }),
  invitedBy: MEMBER.nullable(),
});

const INVITER_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  arrived: z.number().int(),
  pending: z.number().int(),
});

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
      method: "get",
      path: "/invitations/pending",
      tags: [MODERATION_TAG],
      summary:
        "List accounts that registered but never confirmed their address",
      description:
        "Oldest first, because the account stuck longest is the one to look at. From their own side these accounts do not exist: an unverified session reaches nothing but the verification wall.",
      operationId: "listPendingInvitations",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everyone still waiting to confirm",
          content: jsonContent(z.array(PENDING_INVITATION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await InvitationService.listPendingInvitations(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/invitations/inviters",
      tags: [MODERATION_TAG],
      summary: "Count how many members each inviter actually brought in",
      description:
        "`arrived` counts registrations through that member's link whose address was confirmed — opening a link proves nothing, so only confirmed addresses are counted. `pending` are the ones that have not confirmed and are not counted as arrivals.",
      operationId: "listInviters",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Members who have invited somebody, most arrivals first",
          content: jsonContent(z.array(INVITER_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await InvitationService.listInviters(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/invitations/{userId}/reminder",
      tags: [MODERATION_TAG],
      summary: "Send the verification mail again",
      description:
        "Re-issues the ordinary verification link rather than a message of its own: the link is the point, and a second kind of mail carrying it would be a second place for it to go stale. The token cooldown still applies, so pressing this twice sends one mail.",
      operationId: "sendVerificationReminder",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ userId: USER_SCHEMA.shape.id }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The mail is on its way",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such account",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "That address is already confirmed",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      const refusal = await InvitationService.sendVerificationReminder(userId);

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_verified":
          return c.json(
            { error: "Already verified" },
            STATUS_CODE.Conflict,
          );
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  );
