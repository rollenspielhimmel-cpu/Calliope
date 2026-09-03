import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { FORUM_VISIBILITY_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";
import { NOT_FOUND_RESPONSE } from "./shared.ts";

/**
 * Moderation, not administration: which sub-forums exist is what the platform is and lives in
 * `manage_structure.ts`. These two act on one thread — where it belongs, and who may read it.
 *
 * Both go through the reader rather than through the role alone, because a moderator's reach ends
 * below an administrator's: `authorizedAsModerator` says they may moderate at all, and the service
 * says which threads and which sub-forums are theirs to touch.
 */

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_A_MODERATOR_RESPONSE = {
  description: "Not a moderator or administrator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const BEYOND_YOUR_REACH_RESPONSE = {
  description:
    "The thread would end up somewhere the mover cannot read, and so could not be moved back",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "patch",
      path: "/threads/{threadId}/sub-forum",
      tags: [FORUM_TAG],
      summary: "Move a thread into another sub-forum",
      description:
        "The thread keeps its own visibility if it has one, and the stricter of the two still wins — so moving a thread marked closed into an open sub-forum does not publish it. A sub-forum the mover may not read answers 404, the same as reading it would.",
      operationId: "moveForumThread",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({ threadId: z.uuidv7() }),
        body: {
          required: true,
          content: jsonContent(z.object({ subForumId: z.uuidv7() })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The thread is moved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_A_MODERATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { threadId } = c.req.valid("param");
      const { subForumId } = c.req.valid("json");

      const refusal = await ForumThreadService.moveThread(
        threadId,
        subForumId,
        // The session is already resolved: `authenticated` put the user on the context and
        // refused a banned or suspended account. The reading routes next door call `readerOf`
        // instead because they have no session to start from.
        c.get("user"),
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        // Unreachable for a move: a target the mover cannot read is `not_found` above, which is
        // the answer that says nothing about whether it exists.
        case "beyond_your_reach":
          return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/threads/{threadId}/visibility",
      tags: [FORUM_TAG],
      summary: "Set who may read one thread",
      description:
        "`null` lets the thread fall back to its sub-forum's setting. Anything stricter than the setter's own reach is refused with 403: a thread hidden from the person who hid it could not be brought back.",
      operationId: "setForumThreadVisibility",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({ threadId: z.uuidv7() }),
        body: {
          required: true,
          content: jsonContent(
            z.object({ visibility: FORUM_VISIBILITY_SCHEMA.nullable() }),
          ),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The thread's visibility is saved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: BEYOND_YOUR_REACH_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { threadId } = c.req.valid("param");
      const { visibility } = c.req.valid("json");

      const refusal = await ForumThreadService.setThreadVisibility(
        threadId,
        visibility,
        // The session is already resolved: `authenticated` put the user on the context and
        // refused a banned or suspended account. The reading routes next door call `readerOf`
        // instead because they have no session to start from.
        c.get("user"),
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "beyond_your_reach":
          return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        default:
          return assertUnreachable(refusal);
      }
    },
  );
