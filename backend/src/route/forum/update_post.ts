import { OfficialThreadService } from "@/src/service/official_thread_service.ts";
import { REVISION_REASON } from "@/src/route/moderation/official_thread_changes.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { POST_RESPONSE } from "@/src/http/response_schema.ts";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { ForumService } from "@/src/service/forum_service.ts";
import { WritingPostService } from "@/src/service/writing_post_service.ts";
import { mayActInForum } from "@/src/service/forum_authorization.ts";
import { DOCUMENT_SCHEMA } from "@/src/document/document_schema.ts";
import { documentToPlainText } from "@/src/document/document_text.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import {
  WRITING_POST_SCHEMA,
  WRITING_THREAD_SCHEMA,
} from "@/src/database/schema.ts";

const POST_PARAMS = z.object({
  threadId: WRITING_THREAD_SCHEMA.shape.id,
  postId: WRITING_POST_SCHEMA.shape.id,
});

const UPDATE_POST_BODY = z.object({
  document: DOCUMENT_SCHEMA.optional(),
  isDraft: WRITING_POST_SCHEMA.shape.isDraft.optional(),
  /**
   * Warum — nur bei einem offiziellen Beitrag, und dort Pflicht: Eine freigegebene Aussage ändert
   * sich nicht ohne Grund, und der Grund steht mit dem Text vorher und nachher im Protokoll.
   */
  reason: REVISION_REASON.optional(),
}).refine(
  (changes) => Object.values(changes).some((value) => value !== undefined),
  { message: "Provide at least one field to update" },
);

export default new OpenAPIHono().openapi(
  createRoute({
    method: "patch",
    path: "/",
    tags: [FORUM_TAG],
    summary: "Change a post, or publish a draft of one",
    description:
      "A post belongs to whoever wrote it, and only while they may still write in the thread — closing a folder freezes what was written in it. Autosaving a draft is this endpoint too.",
    operationId: "updateForumPost",
    middleware: authenticated,
    request: {
      params: POST_PARAMS,
      body: { required: true, content: jsonContent(UPDATE_POST_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The post as it now stands",
        content: jsonContent(POST_RESPONSE),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such thread or post, or the member may not see it",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...FORBIDDEN_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { threadId, postId } = c.req.valid("param");
    const changes = c.req.valid("json");
    const user = c.get("user");

    const thread = await ForumService.selectThread(user, threadId);
    if (thread === undefined) {
      return c.json({ error: "Thread not found" }, STATUS_CODE.NotFound);
    }

    // Scoped to the thread, so a post id from another thread cannot be reached through it.
    const post = await WritingPostService.selectPost(threadId, postId, user.id);
    if (post === undefined) {
      return c.json({ error: "Post not found" }, STATUS_CODE.NotFound);
    }

    // The bound is on the prose, not the serialisation — see `document_schema.ts`.
    if (changes.document !== undefined) {
      const text = documentToPlainText(changes.document);
      if (text.length === 0 || text.length > TEXT_LIMIT.documentText) {
        return c.json(
          {
            error:
              `A post holds between 1 and ${TEXT_LIMIT.documentText} characters`,
          },
          STATUS_CODE.BadRequest,
        );
      }
    }

    // **Ein offizieller Beitrag gehört der Administration**, nach der Veröffentlichung auch nicht mehr
    // dem, der ihn geschrieben hat: Eine freigegebene Aussage darf sich nicht unbemerkt ändern.
    // Vor der Autorenprüfung und statt ihrer — `post.createdBy` ist hier der angezeigte Absender,
    // und wer sich als dieses Konto anmeldete, gälte sonst als Autor.
    const mayTouch = post.isOfficial
      ? mayAdministerPlatform(user.platformRole)
      : mayActInForum(user, thread.effectiveMemberPermission, "post:change", {
        createdBy: post.createdBy,
        userId: user.id,
      });

    if (!mayTouch) {
      return c.json(
        { error: "You cannot change this post" },
        STATUS_CODE.Forbidden,
      );
    }

    // Offiziell: nur der Text, nur mit Grund, und in derselben Transaktion ins Protokoll.
    if (post.isOfficial) {
      if (changes.reason === undefined || changes.document === undefined) {
        return c.json(
          {
            error:
              "Einen offiziellen Beitrag ändert man mit einem Grund; er steht im Protokoll.",
          },
          STATUS_CODE.BadRequest,
        );
      }

      const refusal = await OfficialThreadService.editOfficialPost(
        threadId,
        postId,
        changes.document,
        changes.reason,
        user,
      );
      if (refusal === "not_found" || refusal === "not_official") {
        return c.json({ error: "Post not found" }, STATUS_CODE.NotFound);
      }

      const edited = await WritingPostService.selectPost(
        threadId,
        postId,
        user.id,
      );
      if (edited === undefined) {
        return c.json({ error: "Post not found" }, STATUS_CODE.NotFound);
      }
      // `unchanged` antwortet mit dem Beitrag, wie er ist: Nichts geändert, nichts zu protokollieren.
      return c.json(edited, STATUS_CODE.OK);
    }

    const { reason: _unused, ...plainChanges } = changes;
    const updated = await WritingPostService.updatePost(
      postId,
      plainChanges,
      post.isDraft,
      // No group, so publishing announces nothing — #119 decides who hears.
      { writingGroupId: null, writingThreadId: threadId, actorId: user.id },
    );
    if (updated === undefined) {
      return c.json({ error: "Post not found" }, STATUS_CODE.NotFound);
    }

    return c.json(updated, STATUS_CODE.OK);
  },
);
