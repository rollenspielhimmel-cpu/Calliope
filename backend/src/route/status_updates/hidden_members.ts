import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "@/src/database/client.ts";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { StatusUpdateService } from "@/src/service/status_update_service.ts";
import { STATUS_UPDATES_TAG } from "@/src/open_api_specification.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";

const MEMBER_PARAMS = z.object({ userId: USER_SCHEMA.shape.id });

/**
 * Wen jemand in den Statusmeldungen nicht sehen will.
 *
 * **Zwei Schalter, nicht einer.** Es gibt Leute, deren Meldungen einem zu viel sind, deren
 * Antworten unter fremden Meldungen aber völlig in Ordnung — und umgekehrt.
 */
const HIDDEN_MEMBER = z.object({
  userId: USER_SCHEMA.shape.id,
  username: z.string(),
  hideUpdates: z.boolean(),
  hideComments: z.boolean(),
});

const SET_HIDDEN_BODY = z.object({
  hideUpdates: z.boolean(),
  hideComments: z.boolean(),
});

/**
 * **Die Moderation blendet niemanden aus.** Für sie muss alles sichtbar sein: Im Löschprotokoll
 * steht nur, was gelöscht wurde — was jemand geschrieben und stehen gelassen hat, sieht man nur,
 * wenn man es sehen kann. Deshalb weist dieser Weg eine Rolle ab, statt Einträge anzulegen, die
 * beim Lesen ohnehin niemand anwendet.
 */
const NOT_FOR_OPERATORS = {
  description: "Operators see everything; they cannot hide members",
  content: jsonContent(ERROR_RESPONSE),
};

const REFUSED_FOR_OPERATOR = {
  error:
    "Die Moderation kann niemanden ausblenden — für sie muss alles sichtbar sein.",
};

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [STATUS_UPDATES_TAG],
      summary: "Who this member hides in the status updates",
      description:
        "One entry per hidden member, with the two switches: their status updates, their comments, or both.",
      operationId: "listHiddenStatusMembers",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Who is hidden, by username",
          content: jsonContent(z.object({ results: z.array(HIDDEN_MEMBER) })),
        },
        [STATUS_CODE.Forbidden]: NOT_FOR_OPERATORS,
        [STATUS_CODE.Unauthorized]: {
          description: "No valid session",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const user = c.get("user");

      if (user.platformRole !== null) {
        return c.json(REFUSED_FOR_OPERATOR, STATUS_CODE.Forbidden);
      }

      return c.json(
        { results: await StatusUpdateService.listHiddenMembers(user.id) },
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/{userId}",
      tags: [STATUS_UPDATES_TAG],
      summary: "Hide or show a member in the status updates",
      description:
        "Both switches off means the entry disappears — that is how somebody becomes visible again. Filtered on read, never on write, so showing somebody again brings back what was hidden.",
      operationId: "setHiddenStatusMember",
      middleware: authenticated,
      request: {
        params: MEMBER_PARAMS,
        body: { required: true, content: jsonContent(SET_HIDDEN_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Who is hidden now",
          content: jsonContent(z.object({ results: z.array(HIDDEN_MEMBER) })),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such member",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Hiding yourself is not a thing",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: NOT_FOR_OPERATORS,
        [STATUS_CODE.Unauthorized]: {
          description: "No valid session",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const user = c.get("user");

      if (user.platformRole !== null) {
        return c.json(REFUSED_FOR_OPERATOR, STATUS_CODE.Forbidden);
      }

      const refusal = await db.transaction().execute((transaction) =>
        StatusUpdateService.setHiddenMember(
          transaction,
          user.id,
          c.req.valid("param").userId,
          c.req.valid("json"),
        )
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_yourself":
          return c.json(
            { error: "Dich selbst kannst du nicht ausblenden." },
            STATUS_CODE.Conflict,
          );
        default:
          // Die ganze Liste zurück, nicht nur die eine Zeile: Der Dialog zeigt sie als Ganzes,
          // und so kann er nicht auseinanderlaufen, wenn jemand in zwei Fenstern arbeitet.
          return c.json(
            { results: await StatusUpdateService.listHiddenMembers(user.id) },
            STATUS_CODE.OK,
          );
      }
    },
  );
