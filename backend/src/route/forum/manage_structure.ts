import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { FORUM_TAG } from "@/src/open_api_specification.ts";
import { FORUM_VISIBILITY_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { ForumStructureService } from "@/src/service/forum_structure_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Administration, not moderation: which sub-forums exist and who may read them is what the
 * platform *is*, rather than an act on one piece of content. Moving a single thread between
 * sub-forums is the moderation half and lives with the threads.
 */

const CATEGORY_BODY = z.object({
  title: notBlank(z.string().min(1).max(TEXT_LIMIT.forumCategoryTitle)),
  position: z.number().int().min(0).default(0),
});

const SUB_FORUM_BODY = z.object({
  categoryId: z.uuidv7(),
  title: notBlank(z.string().min(1).max(TEXT_LIMIT.subForumTitle)),
  // Required, unlike most prose here: a sub-forum nobody can place is one nobody posts in.
  description: notBlank(z.string().min(1).max(TEXT_LIMIT.subForumDescription)),
  visibility: FORUM_VISIBILITY_SCHEMA,
  position: z.number().int().min(0).default(0),
});

/** The whole structure, closed sub-forums included — this is the thing being edited. */
const STRUCTURE_RESPONSE = z.array(z.object({
  id: z.uuidv7(),
  title: z.string(),
  position: z.number().int(),
  subForums: z.array(z.object({
    id: z.uuidv7(),
    categoryId: z.uuidv7(),
    title: z.string(),
    description: z.string(),
    visibility: FORUM_VISIBILITY_SCHEMA,
    position: z.number().int(),
  })),
}));

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_ADMINISTRATOR_RESPONSE = {
  description: "Not an administrator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_FOUND_RESPONSE = {
  description: "No such category or sub-forum",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/structure",
      tags: [FORUM_TAG],
      summary: "The whole structure, for editing it",
      description:
        "Unlike the overview this hides nothing and counts nothing: it is what the administration form is drawn from.",
      operationId: "getForumStructure",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every category with its sub-forums, in their order",
          content: jsonContent(STRUCTURE_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await ForumStructureService.listStructure(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/categories",
      tags: [FORUM_TAG],
      summary: "Add a category",
      description: "A heading over sub-forums; it holds no content of its own.",
      operationId: "createForumCategory",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(CATEGORY_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The category, as stored",
          content: jsonContent(z.object({ id: z.uuidv7() })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { title, position } = c.req.valid("json");
      const id = await ForumStructureService.createCategory(title, position);
      return c.json({ id }, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/categories/{categoryId}",
      tags: [FORUM_TAG],
      summary: "Rename a category or move it in the order",
      operationId: "updateForumCategory",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ categoryId: z.uuidv7() }),
        body: { required: true, content: jsonContent(CATEGORY_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The category is saved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { categoryId } = c.req.valid("param");

      if (
        await ForumStructureService.updateCategory(
          categoryId,
          c.req.valid("json"),
        ) === "not_found"
      ) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/categories/{categoryId}",
      tags: [FORUM_TAG],
      summary: "Delete an empty category",
      description:
        "Refused while it still holds sub-forums, rather than taking them and their threads with it. Move or delete those first.",
      operationId: "deleteForumCategory",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ categoryId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The category is gone",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Conflict]: {
          description: "It still holds sub-forums",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { categoryId } = c.req.valid("param");

      switch (await ForumStructureService.deleteCategory(categoryId)) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_empty":
          return c.json(
            { error: "The category still holds sub-forums" },
            STATUS_CODE.Conflict,
          );
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sub-forums",
      tags: [FORUM_TAG],
      summary: "Add a sub-forum",
      description:
        "`visibility` decides who may read it: `everyone` needs no account at all, `members` a signed-in one, and the two above that a platform role. A thread inside may narrow this but never widen it.",
      operationId: "createSubForum",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(SUB_FORUM_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The sub-forum, as stored",
          content: jsonContent(z.object({ id: z.uuidv7() })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const created = await ForumStructureService.createSubForum(
        c.req.valid("json"),
      );

      if (created === "category_not_found") {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json(created, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/sub-forums/{subForumId}",
      tags: [FORUM_TAG],
      summary: "Edit a sub-forum, move it between categories, or reorder it",
      description:
        "One route for all three: the category is a value on the sub-forum, so moving it is the same write as renaming it.",
      operationId: "updateSubForum",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ subForumId: z.uuidv7() }),
        body: { required: true, content: jsonContent(SUB_FORUM_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The sub-forum is saved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { subForumId } = c.req.valid("param");
      const refusal = await ForumStructureService.updateSubForum(
        subForumId,
        c.req.valid("json"),
      );

      if (refusal !== undefined) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/sub-forums/{subForumId}",
      tags: [FORUM_TAG],
      summary: "Delete an empty sub-forum",
      description:
        "Refused while it still holds threads. A sub-forum nobody should reach any more is closed by setting its visibility, which keeps what was written.",
      operationId: "deleteSubForum",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ subForumId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The sub-forum is gone",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Conflict]: {
          description: "It still holds threads",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { subForumId } = c.req.valid("param");

      switch (await ForumStructureService.deleteSubForum(subForumId)) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "not_empty":
          return c.json(
            { error: "The sub-forum still holds threads" },
            STATUS_CODE.Conflict,
          );
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  );
