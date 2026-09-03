import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { PLATFORM_ROLE_SCHEMA, USER_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import {
  authorizedAsAdministrator,
  authorizedAsModerator,
} from "@/src/middleware/authorized_as_platform_role.ts";
import { PlatformRoleService } from "@/src/service/platform_role_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

const OPERATOR_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  platformRole: PLATFORM_ROLE_SCHEMA,
  isPrimordialAdmin: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});

/** Null is the ordinary member, so revoking is granting `null` rather than its own route. */
const SET_ROLE_BODY = z.object({
  platformRole: PLATFORM_ROLE_SCHEMA.nullable(),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/operators",
      tags: [MODERATION_TAG],
      summary: "List everyone holding a platform role",
      description:
        "Readable by any operator: knowing who else is on the team is not the same as being able to change it.",
      operationId: "listOperators",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description:
            "Administrators first, then moderators, each alphabetically",
          content: jsonContent(z.array(OPERATOR_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: {
          description: "Not an operator",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await PlatformRoleService.listOperators(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/operators/{userId}",
      tags: [MODERATION_TAG],
      summary: "Grant or revoke a platform role",
      description:
        "Administrator only, because this is what changes the platform itself. `null` revokes, making the account an ordinary member again. Nobody may change their own role, which is what keeps the last administrator seat occupied. Granting or revoking `administrator` is reserved to the first administrator, and that account's own role cannot be changed by anybody — the database refuses it as well as this route.",
      operationId: "setPlatformRole",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ userId: USER_SCHEMA.shape.id }),
        body: { required: true, content: jsonContent(SET_ROLE_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The role is set",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: {
          description:
            "Not an administrator, changing one's own role, granting a role to a banned account, touching the first administrator's role, or an ordinary administrator trying to grant or revoke `administrator`",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such account",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      const { platformRole } = c.req.valid("json");

      const actor = c.get("user");

      const refusal = await PlatformRoleService.setRole(userId, platformRole, {
        id: actor.id,
        isPrimordialAdmin: actor.isPrimordialAdmin,
      });

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "is_self":
          return c.json(
            { error: "You cannot change your own role" },
            STATUS_CODE.Forbidden,
          );
        case "is_banned":
          return c.json(
            { error: "A banned account cannot be given a role" },
            STATUS_CODE.Forbidden,
          );
        case "is_primordial":
          return c.json(
            { error: "The first administrator's role cannot be changed" },
            STATUS_CODE.Forbidden,
          );
        case "administrator_is_reserved":
          return c.json(
            {
              error:
                "Only the first administrator may grant or revoke the administrator role",
            },
            STATUS_CODE.Forbidden,
          );
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  );
