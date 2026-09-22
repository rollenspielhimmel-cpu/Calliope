import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { PLATFORM_ROLE_SCHEMA, USER_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BroadcastSenderService } from "@/src/service/broadcast_sender_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Wer welchen Absender nutzen darf — eine Rolle oder eine einzelne Person.
 *
 * Lesen darf jede Administration, ändern nur der Ur-Admin, wie bei der Absenderliste selbst und
 * aus demselben Grund im Handler geprüft: Das Vokabular der Mittelstücke sind Rollen, und das hier
 * liegt eine Ebene darüber.
 *
 * Ein Absender wird mit der Kennung angesprochen, die die Absenderliste zeigt — bei „Admin" also
 * mit der des Ur-Admin-Kontos. Der Dienst übersetzt das in den Schlüssel der Tabelle.
 */

const GRANTABLE_ROLE_SCHEMA = PLATFORM_ROLE_SCHEMA.exclude(["administrator"]);

const GRANT_RESPONSE = z.object({
  senderId: USER_SCHEMA.shape.id,
  role: GRANTABLE_ROLE_SCHEMA.nullable(),
  userId: USER_SCHEMA.shape.id.nullable(),
  username: z.string().nullable(),
  grantedAt: z.iso.datetime({ offset: true }),
});

const ROLE_PARAMS = z.object({
  senderId: USER_SCHEMA.shape.id,
  role: GRANTABLE_ROLE_SCHEMA,
});

const PERSON_PARAMS = z.object({
  senderId: USER_SCHEMA.shape.id,
  userId: USER_SCHEMA.shape.id,
});

const NOT_THE_ROOT_ADMIN = {
  description: "Only the first administrator may change this",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_A_SENDER = {
  description: "No such released sender, or no such account",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const REFUSAL = "Wer welchen Absender nutzen darf, legt der Ur-Admin fest.";

const OK = { ok: true } as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/broadcast/sender-grants",
      tags: [MODERATION_TAG],
      summary: "Which roles and people may use which sender",
      description:
        "Every administrator may read it; only the first administrator changes it. Administrators may use every released sender and are not listed.",
      operationId: "listSenderGrants",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every grant, to a role or to a person",
          content: jsonContent(z.array(GRANT_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await BroadcastSenderService.listGrants(), STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/broadcast/senders/{senderId}/roles/{role}",
      tags: [MODERATION_TAG],
      summary: "Let a role prepare under a sender",
      description: "Only the first administrator. Idempotent.",
      operationId: "grantSenderToRole",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: ROLE_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Granted",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_A_SENDER,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!user.isPrimordialAdmin) {
        return c.json({ error: REFUSAL }, STATUS_CODE.Forbidden);
      }

      const { senderId, role } = c.req.valid("param");
      const refusal = await BroadcastSenderService.grant(
        senderId,
        { role },
        user.id,
      );

      return refusal === undefined ? c.json(OK, STATUS_CODE.OK) : c.json(
        { error: "Diesen Absender gibt es nicht." },
        STATUS_CODE.NotFound,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/broadcast/senders/{senderId}/roles/{role}",
      tags: [MODERATION_TAG],
      summary: "Take a sender from a role",
      description:
        "Only the first administrator. What the role already submitted stays in the queue; an administrator may still approve it.",
      operationId: "revokeSenderFromRole",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: ROLE_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Revoked",
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
        return c.json({ error: REFUSAL }, STATUS_CODE.Forbidden);
      }

      const { senderId, role } = c.req.valid("param");
      await BroadcastSenderService.revoke(senderId, { role });

      return c.json(OK, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/broadcast/senders/{senderId}/people/{userId}",
      tags: [MODERATION_TAG],
      summary: "Let one person prepare under a sender",
      description:
        "Only the first administrator. The person may then prepare and submit under this sender whatever their role — with no role at all included — and keeps it when their role changes. Idempotent.",
      operationId: "grantSenderToPerson",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: PERSON_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Granted",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_A_SENDER,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!user.isPrimordialAdmin) {
        return c.json({ error: REFUSAL }, STATUS_CODE.Forbidden);
      }

      const { senderId, userId } = c.req.valid("param");
      const refusal = await BroadcastSenderService.grant(
        senderId,
        { userId },
        user.id,
      );

      if (refusal === undefined) {
        return c.json(OK, STATUS_CODE.OK);
      }

      return c.json(
        {
          error: refusal === "not_found"
            ? "Dieses Konto gibt es nicht."
            : "Diesen Absender gibt es nicht.",
        },
        STATUS_CODE.NotFound,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/broadcast/senders/{senderId}/people/{userId}",
      tags: [MODERATION_TAG],
      summary: "Take a sender from one person",
      description:
        "Only the first administrator. What the person already submitted stays in the queue; an administrator may still approve it.",
      operationId: "revokeSenderFromPerson",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: PERSON_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Revoked",
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
        return c.json({ error: REFUSAL }, STATUS_CODE.Forbidden);
      }

      const { senderId, userId } = c.req.valid("param");
      await BroadcastSenderService.revoke(senderId, { userId });

      return c.json(OK, STATUS_CODE.OK);
    },
  );
