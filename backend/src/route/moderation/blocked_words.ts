import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import {
  MINIMUM_WORD_LENGTH,
  WordFilterService,
} from "@/src/service/word_filter_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * The word list, beside the domain list and guarded the same way: administrator rather than
 * moderator, because this decides what the whole community may print rather than what happens to
 * one account.
 *
 * Nothing here masks anything. The masking is `word_filter_service.ts`, applied where text is
 * read — see its own comment for why that is the whole design and not an implementation detail.
 */

/**
 * Two characters is the floor, and the table enforces it too. Below that the entry stops being a
 * word and becomes a syllable that masks the middle of half the dictionary — „er" would take
 * „Feder", „aber" and „Mutter" with it.
 */
const WORD = notBlank(
  z.string().min(MINIMUM_WORD_LENGTH).max(TEXT_LIMIT.blockedWord),
);

const BLOCKED_WORD_RESPONSE = z.object({
  word: z.string(),
  addedBy: z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
  }).nullable(),
  addedAt: z.iso.datetime({ offset: true }),
  note: z.string().nullable(),
});

const BLOCK_WORD_BODY = z.object({
  word: WORD,
  note: notBlank(z.string().min(1).max(TEXT_LIMIT.blockedWordNote)).nullish(),
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
      path: "/blocked-words",
      tags: [MODERATION_TAG],
      summary: "Every word the community does not print",
      description:
        "Alphabetical, because this is a list somebody reads to find out whether something is on it. The words are stored lower-cased; the match itself ignores case either way.",
      operationId: "listBlockedWords",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every blocked word",
          content: jsonContent(z.array(BLOCKED_WORD_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await WordFilterService.listBlockedWords(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blocked-words",
      tags: [MODERATION_TAG],
      summary: "Put a word on the list",
      description:
        "Takes effect on everything already written, without any of it being rewritten — the mask is applied when text is read. Adding a word already on the list only refreshes its note.",
      operationId: "blockWord",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(BLOCK_WORD_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The word is on the list",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { word, note } = c.req.valid("json");

      await WordFilterService.blockWord(word, c.get("user").id, note ?? null);

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/blocked-words/{word}",
      tags: [MODERATION_TAG],
      summary: "Take a word off the list",
      description:
        "Every text that held it becomes readable again exactly as it was written. Nothing was ever changed in storage, which is what makes this possible.",
      operationId: "unblockWord",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ word: WORD }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The word is off the list",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      await WordFilterService.unblockWord(c.req.valid("param").word);

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
