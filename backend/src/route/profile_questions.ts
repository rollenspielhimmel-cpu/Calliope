import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { USERS_TAG } from "@/src/open_api_specification.ts";
import { PROFILE_QUESTION_KIND_SCHEMA } from "@/src/database/schema.ts";
import { LIST_LIMIT, TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { ProfileQuestionService } from "@/src/service/profile_question_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * Reading the questions is any member's business — they are the form the profile offers. Writing
 * them is an administrator's, because it changes what the platform asks everybody.
 */

const QUESTION_RESPONSE = z.object({
  id: z.uuidv7(),
  section: z.string(),
  prompt: z.string(),
  kind: PROFILE_QUESTION_KIND_SCHEMA,
  position: z.number().int(),
  options: z.array(z.object({ id: z.uuidv7(), label: z.string() })),
});

const WRITE_QUESTION_BODY = z.object({
  section: notBlank(z.string().min(1).max(TEXT_LIMIT.profileQuestionSection)),
  prompt: notBlank(z.string().min(1).max(TEXT_LIMIT.profileQuestionPrompt)),
  kind: PROFILE_QUESTION_KIND_SCHEMA,
  position: z.number().int().min(0),
  // Empty for a text question. Bounded for the same reason every list here is.
  options: z
    .array(notBlank(z.string().min(1).max(TEXT_LIMIT.profileQuestionOption)))
    .max(LIST_LIMIT.profileQuestionOptions)
    .default([]),
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
      tags: [USERS_TAG],
      summary: "List the optional profile questions",
      description:
        "The questions a profile may answer, by section and then by position. Readable by any member, because this is the form their own profile offers them.",
      operationId: "listProfileQuestions",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description:
            "Every question, with the options a choice question offers",
          content: jsonContent(z.array(QUESTION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: {
          description: "Email address not verified",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await ProfileQuestionService.listQuestions(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: [USERS_TAG],
      summary: "Add a profile question",
      operationId: "createProfileQuestion",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: { required: true, content: jsonContent(WRITE_QUESTION_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The question, as stored",
          content: jsonContent(z.object({ id: z.uuidv7() })),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const id = await ProfileQuestionService.writeQuestion(
        c.req.valid("json"),
      );
      return c.json({ id }, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/{questionId}",
      tags: [USERS_TAG],
      summary: "Rewrite a profile question",
      description:
        "The options are replaced rather than merged. An option that goes away takes the answers naming it with it, which is the honest outcome: an answer pointing at a choice that no longer exists says nothing about the person who gave it.",
      operationId: "updateProfileQuestion",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: z.object({ questionId: z.uuidv7() }),
        body: { required: true, content: jsonContent(WRITE_QUESTION_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The question is saved",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such question",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { questionId } = c.req.valid("param");

      try {
        await ProfileQuestionService.writeQuestion({
          id: questionId,
          ...c.req.valid("json"),
        });
      } catch {
        // `executeTakeFirstOrThrow` on the update is what says the question is not there.
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/{questionId}",
      tags: [USERS_TAG],
      summary: "Remove a profile question",
      description:
        "The answers go with it: they were answers to this question and to nothing else.",
      operationId: "deleteProfileQuestion",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ questionId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The question is gone",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such question",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { questionId } = c.req.valid("param");

      if (
        await ProfileQuestionService.deleteQuestion(questionId) === "not_found"
      ) {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
