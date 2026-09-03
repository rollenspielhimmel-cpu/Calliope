import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { USERS_TAG } from "@/src/open_api_specification.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { ProfileQuestionService } from "@/src/service/profile_question_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/** As many answers as there could plausibly be questions, which is what bounds the request. */
const MAXIMUM_ANSWERS = 200;

/**
 * Answering the optional profile questions. An answer left empty removes the row rather than
 * storing a blank, which is what makes the question disappear from the profile entirely — the
 * rule that a member who answers nothing shows no questions at all, only their own text.
 */
const SET_PROFILE_ANSWERS_BODY = z.object({
  answers: z.array(
    z.object({
      questionId: z.uuidv7(),
      // Both optional and both absent means "no answer", which is how one is withdrawn.
      text: z.string().max(TEXT_LIMIT.profileDetail).optional(),
      optionId: z.uuidv7().optional(),
    }),
  ).max(MAXIMUM_ANSWERS),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "put",
    path: "/profile-answers",
    tags: [USERS_TAG],
    summary: "Answer the optional profile questions",
    description:
      "Sends the answers that changed. An entry with neither a text nor an option withdraws that answer, and the question then does not appear on the profile at all.",
    operationId: "setProfileAnswers",
    middleware: authenticated,
    request: {
      body: { required: true, content: jsonContent(SET_PROFILE_ANSWERS_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The answers are saved",
        content: jsonContent(OK_RESPONSE),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Email address not verified",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { answers } = c.req.valid("json");

    await ProfileQuestionService.setAnswers(c.get("user").id, answers);

    return c.json({ ok: true } as const, STATUS_CODE.OK);
  },
);
