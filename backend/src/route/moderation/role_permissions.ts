import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import {
  PLATFORM_PERMISSION_SCHEMA,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLE_SCHEMA,
} from "@/src/database/schema.ts";
import { RolePermissionService } from "@/src/service/role_permission_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * What each role may do beyond its name. Readable by every administrator, changed only by the
 * first — the same split as the sender list, and checked in the handler for the same reason: the
 * middleware vocabulary is roles, and this sits one level above them.
 *
 * `administrator` is not a role that can be named here. It has everything, and the path refuses it
 * rather than letting the database answer with a 500.
 */

const GRANTABLE_ROLE_SCHEMA = PLATFORM_ROLE_SCHEMA.exclude(["administrator"]);

const ROLE_PERMISSIONS_RESPONSE = z.object({
  /** Every role that can be given something, so the interface shows one row each. */
  roles: z.array(GRANTABLE_ROLE_SCHEMA),
  /** Every permission there is, so the interface shows one switch each. */
  permissions: z.array(PLATFORM_PERMISSION_SCHEMA),
  granted: z.array(z.object({
    role: GRANTABLE_ROLE_SCHEMA,
    permission: PLATFORM_PERMISSION_SCHEMA,
    grantedByUsername: z.string().nullable(),
    grantedAt: z.iso.datetime({ offset: true }),
  })),
});

const PARAMS = z.object({
  role: GRANTABLE_ROLE_SCHEMA,
  permission: PLATFORM_PERMISSION_SCHEMA,
});

const NOT_THE_ROOT_ADMIN = {
  description: "Only the first administrator may change this",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const REFUSAL = "Was eine Rolle darf, legt der Ur-Admin fest.";

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/role-permissions",
      tags: [MODERATION_TAG],
      summary: "What each role may do beyond its name",
      description:
        "Every administrator may read it; only the first administrator changes it. Administrators are not listed — they may everything.",
      operationId: "listRolePermissions",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The roles, the permissions, and which is granted",
          content: jsonContent(ROLE_PERMISSIONS_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json({
        roles: GRANTABLE_ROLE_SCHEMA.options,
        permissions: [...PLATFORM_PERMISSIONS],
        granted: await RolePermissionService.list(),
      }, STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/role-permissions/{role}/{permission}",
      tags: [MODERATION_TAG],
      summary: "Give a role a permission",
      description:
        "Only the first administrator. Idempotent; the first grant's who and when are kept. Takes effect with the next request of everybody in the role.",
      operationId: "grantRolePermission",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Granted",
          content: jsonContent(OK_RESPONSE),
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
        return c.json({ error: REFUSAL }, STATUS_CODE.Forbidden);
      }

      const { role, permission } = c.req.valid("param");
      await RolePermissionService.grant(role, permission, user.id);

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/role-permissions/{role}/{permission}",
      tags: [MODERATION_TAG],
      summary: "Take a permission from a role",
      description:
        "Only the first administrator. What the role already prepared stays where it is; it can no longer be reached by that role.",
      operationId: "revokeRolePermission",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: PARAMS },
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

      const { role, permission } = c.req.valid("param");
      await RolePermissionService.revoke(role, permission);

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
