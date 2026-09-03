import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { CUSTOM_PAGES_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { resolveSessionUser } from "@/src/middleware/session_user.ts";
import { CustomPageService } from "@/src/service/custom_page_service.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Deliberately not behind `authenticated`: a page may be public, and the rules are exactly the
 * kind of thing somebody should be able to read before deciding to join. Which pages those are
 * is the page's own `is_public`, so the session is resolved by hand rather than by a middleware
 * that would have to refuse before the page is known.
 */

export const PAGE_SLUG = z
  .string()
  .min(1)
  .max(TEXT_LIMIT.customPageSlug)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Nur Kleinbuchstaben, Ziffern und Bindestriche",
  );

const MEMBER = z.object({ id: z.uuidv7(), username: z.string() });

const PAGE_RESPONSE = z.object({
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  isPublic: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lastEditedBy: MEMBER.nullable(),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/{slug}",
    tags: [CUSTOM_PAGES_TAG],
    summary: "Read one page",
    description:
      "A public page is readable by anybody, including somebody with no account. A page that is not public answers 404 rather than 403 to a reader without a session, so its existence stays hidden — the same rule the rest of the API follows.",
    operationId: "readCustomPage",
    request: { params: z.object({ slug: PAGE_SLUG }) },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The page",
        content: jsonContent(PAGE_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such page, or it is not readable without an account",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { slug } = c.req.valid("param");
    const page = await CustomPageService.selectPage(slug);

    if (page === undefined) {
      return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
    }

    if (!page.isPublic && await resolveSessionUser(c) === undefined) {
      return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
    }

    return c.json(page, STATUS_CODE.OK);
  },
);
