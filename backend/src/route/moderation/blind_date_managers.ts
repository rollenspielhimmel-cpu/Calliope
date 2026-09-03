import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BlindDateAccessService } from "@/src/service/blind_date_access_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Who may work the Blind-Date desk, given out and taken back.
 *
 * **Only by the root administrator**, which is checked in the handlers rather than by a middleware:
 * the middleware vocabulary here is roles, and this is the level above them — the same place the
 * granting of the administrator role itself sits.
 *
 * A file of its own, and deliberately **not** behind `authorizedForBlindDate`. Granting is not desk
 * work: somebody has to be able to hand the right out while every manager is suspended, and a guard
 * that suspended the granting too would be a lock with its key inside.
 */

const MANAGER_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  /**
   * True while their own Blind-Date application is open. They hold the right and cannot use it
   * right now — the list says so rather than showing them as if nothing were different, because
   * „warum sieht sie die Warteschlange nicht" is the question this answers before it is asked.
   */
  isSuspended: z.boolean(),
});

const NOT_THE_ROOT_ADMIN = {
  description: "Only the first administrator may change this",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/managers",
      tags: [MODERATION_TAG],
      summary: "Who may work the Blind-Date desk",
      description:
        "Everybody holding the right, and whether each is currently suspended by an application of their own. The first administrator holds it by being that account and is not in this list.",
      operationId: "listBlindDateManagers",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The people holding the right",
          content: jsonContent(z.array(MANAGER_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      if (!c.get("user").isPrimordialAdmin) {
        return c.json(
          { error: "Only the first administrator may see this" },
          STATUS_CODE.Forbidden,
        );
      }

      return c.json(
        await BlindDateAccessService.listManagers(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/blind-date/managers/{userId}",
      tags: [MODERATION_TAG],
      summary: "Give somebody the Blind-Date desk, or take it back",
      description:
        "Only the first administrator, and only for somebody who is already an operator: a right that decides what an operator may reach means nothing to a member who cannot reach the moderation at all. `mayManage` false takes it away again.",
      operationId: "setBlindDateManagement",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ userId: USER_SCHEMA.shape.id }),
        body: {
          required: true,
          content: jsonContent(z.object({ mayManage: z.boolean() })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The right is set",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No member has this id",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_THE_ROOT_ADMIN,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      if (!c.get("user").isPrimordialAdmin) {
        return c.json(
          { error: "Only the first administrator may change this" },
          STATUS_CODE.Forbidden,
        );
      }

      const refusal = await BlindDateAccessService.setManagement(
        c.req.valid("param").userId,
        c.req.valid("json").mayManage,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_an_operator":
          return c.json(
            {
              error:
                "Dieses Recht kann nur an Teammitglieder vergeben werden. Der Ur-Admin hat es ohnehin.",
            },
            STATUS_CODE.Forbidden,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  );
