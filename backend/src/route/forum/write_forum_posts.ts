import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { DOCUMENT_SCHEMA } from "@/src/document/document_schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import { mayModeratePlatform } from "@/src/service/platform_authorization.ts";
import { ForumThreadService } from "@/src/service/forum_thread_service.ts";
import { mayPost } from "@/src/service/forum_visibility.ts";
import {
  MAY_NOT_POST_RESPONSE,
  NOT_FOUND_RESPONSE,
  readerOf,
} from "./shared.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/** Writing in the forum: opening a thread, answering in one, and changing what is there. */
const THREAD_TITLE = notBlank(z.string().min(1).max(TEXT_LIMIT.threadTitle));

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "post",
      path: "/sub-forums/{subForumId}/threads",
      tags: [FORUM_TAG],
      summary: "Open a thread, with its first post",
      description:
        "The thread and the post are written together: a thread with nothing in it would stand in every list as a row nobody can answer. Needs a session even where reading needs none.",
      operationId: "createForumThread",
      request: {
        params: z.object({ subForumId: z.uuidv7() }),
        body: {
          required: true,
          content: jsonContent(
            z.object({ title: THREAD_TITLE, document: DOCUMENT_SCHEMA }),
          ),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The thread, as opened",
          content: jsonContent(z.object({ threadId: z.uuidv7() })),
        },
        [STATUS_CODE.Forbidden]: MAY_NOT_POST_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { subForumId } = c.req.valid("param");
      const { title, document } = c.req.valid("json");
      const reader = await readerOf(c);

      const subForum = await ForumThreadService.selectSubForum(
        subForumId,
        reader,
      );

      if (subForum === undefined) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      // Reading a sub-forum without an account is allowed; writing in one never is.
      if (!mayPost(subForum.visibility, reader) || reader === undefined) {
        return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
      }

      return c.json(
        await ForumThreadService.createThread(
          subForumId,
          title,
          document,
          reader.id,
        ),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/threads/{threadId}/posts",
      tags: [FORUM_TAG],
      summary: "Answer in a thread",
      operationId: "createForumPost",
      request: {
        params: z.object({ threadId: z.uuidv7() }),
        body: {
          required: true,
          content: jsonContent(z.object({ document: DOCUMENT_SCHEMA })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The post, as written",
          content: jsonContent(z.object({ postId: z.uuidv7() })),
        },
        [STATUS_CODE.Forbidden]: MAY_NOT_POST_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { threadId } = c.req.valid("param");
      const { document } = c.req.valid("json");
      const reader = await readerOf(c);

      const thread = await ForumThreadService.selectThread(threadId, reader);

      if (thread === undefined) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      if (
        !mayPost(thread.effectiveVisibility, reader) || reader === undefined
      ) {
        return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
      }

      return c.json(
        await ForumThreadService.createPost(threadId, document, reader.id),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/threads/{threadId}/posts/{postId}",
      tags: [FORUM_TAG],
      summary: "Change a post that is already there",
      description:
        "Marks it edited, which is the one change a reader is told about. An operator may change anybody's; everybody else only their own.",
      operationId: "updateForumPost",
      request: {
        params: z.object({ threadId: z.uuidv7(), postId: z.uuidv7() }),
        body: {
          required: true,
          content: jsonContent(z.object({ document: DOCUMENT_SCHEMA })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The post is changed",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: MAY_NOT_POST_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { threadId, postId } = c.req.valid("param");
      const { document } = c.req.valid("json");
      const reader = await readerOf(c);

      const thread = await ForumThreadService.selectThread(threadId, reader);

      if (thread === undefined || reader === undefined) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      const refusal = await ForumThreadService.updatePost(
        threadId,
        postId,
        document,
        reader.id,
        mayModeratePlatform(reader.platformRole),
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_yours":
          return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/threads/{threadId}/posts/{postId}",
      tags: [FORUM_TAG],
      summary: "Remove a post",
      description:
        "Removing the last post of a thread removes the thread as well, because a thread with nothing in it is the empty row opening one is written to prevent.",
      operationId: "deleteForumPost",
      request: {
        params: z.object({ threadId: z.uuidv7(), postId: z.uuidv7() }),
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The post is gone",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: MAY_NOT_POST_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { threadId, postId } = c.req.valid("param");
      const reader = await readerOf(c);

      const thread = await ForumThreadService.selectThread(threadId, reader);

      if (thread === undefined || reader === undefined) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      const refusal = await ForumThreadService.deletePost(
        threadId,
        postId,
        reader.id,
        mayModeratePlatform(reader.platformRole),
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_yours":
          return c.json({ error: "Forbidden" }, STATUS_CODE.Forbidden);
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  );
