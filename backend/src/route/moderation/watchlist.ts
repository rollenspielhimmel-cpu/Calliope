import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { WatchlistService } from "@/src/service/watchlist_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

const USER_PARAM = z.object({ userId: USER_SCHEMA.shape.id });

const MEMBER = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
});

const WATCHLIST_ENTRY_RESPONSE = z.object({
  user: MEMBER,
  note: z.string(),
  addedBy: MEMBER.nullable(),
  addedAt: z.iso.datetime({ offset: true }),
});

const ADD_TO_WATCHLIST_BODY = z.object({
  // Same bound as a ban's note: a short remark, not a file.
  note: notBlank(z.string().min(1).max(TEXT_LIMIT.banReason)),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_OPERATOR_RESPONSE = {
  description: "Not an operator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

// Literal before the parameterised one, or `/watchlist` is a candidate for `/{userId}`.
export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/watchlist",
      tags: [MODERATION_TAG],
      summary: "List every member on the watchlist",
      description:
        "Not the report queue and not the strike history: nothing here has been decided, these are people somebody thought worth a second look.",
      operationId: "listWatchlist",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everyone currently watched, most recently added first",
          content: jsonContent(z.array(WATCHLIST_ENTRY_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await WatchlistService.listWatchlist(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/watchlist/{userId}",
      tags: [MODERATION_TAG],
      summary: "Put a member on the watchlist",
      description:
        "Idempotent: somebody already on it has their note and time updated rather than a second row added, which is why this is a PUT.",
      operationId: "addToWatchlist",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: USER_PARAM,
        body: { required: true, content: jsonContent(ADD_TO_WATCHLIST_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "On the watchlist",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
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
      const { note } = c.req.valid("json");

      const refusal = await WatchlistService.addToWatchlist(
        userId,
        note,
        c.get("user").id,
      );

      if (refusal === "not_found") {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/watchlist/{userId}",
      tags: [MODERATION_TAG],
      summary: "Take a member off the watchlist",
      operationId: "removeFromWatchlist",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: USER_PARAM },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Off the watchlist, or was never on it",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      await WatchlistService.removeFromWatchlist(userId);
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
