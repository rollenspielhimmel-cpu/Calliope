import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { PAGES_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { CustomPageService } from "@/src/service/custom_page_service.ts";
import { PAGE_SLUG } from "./read_page.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

const MEMBER = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
});

/** No body: a list of pages is read to pick one from, not to read them all at once. */
const PAGE_SUMMARY_RESPONSE = z.object({
  slug: z.string(),
  title: z.string(),
  isPublic: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lastEditedBy: MEMBER.nullable(),
});

const WRITE_PAGE_BODY = z.object({
  title: notBlank(z.string().min(1).max(TEXT_LIMIT.pageTitle)),
  // Markdown. Nothing in this product takes rich text, and a stored document tree would tie
  // the page to whichever editor produced it.
  body: notBlank(z.string().min(1).max(TEXT_LIMIT.pageBody)),
  isPublic: z.boolean(),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_ADMINISTRATOR_RESPONSE = {
  description: "Not an administrator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [PAGES_TAG],
      summary: "List every page, public or not",
      description:
        "Administrator only, unlike reading one: this is the list of what exists, including the pages that are not public.",
      operationId: "listPages",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every page, by title",
          content: jsonContent(z.array(PAGE_SUMMARY_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await CustomPageService.listPages(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/{slug}",
      tags: [PAGES_TAG],
      summary: "Create or rewrite a page",
      description:
        "One route for both, because the slug is the identity: writing to one that does not exist yet is how a page is made. Changing a page's address is therefore making a different page, which is deliberate — the link somebody bookmarked should keep meaning what it meant.",
      operationId: "writePage",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ slug: PAGE_SLUG }),
        body: { required: true, content: jsonContent(WRITE_PAGE_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The page is saved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");
      const page = c.req.valid("json");

      await CustomPageService.upsertPage({ slug, ...page }, c.get("user").id);
      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/{slug}",
      tags: [PAGES_TAG],
      summary: "Delete a page",
      operationId: "deletePage",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ slug: PAGE_SLUG }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The page is gone",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such page",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");

      if (await CustomPageService.deletePage(slug) === "not_found") {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
