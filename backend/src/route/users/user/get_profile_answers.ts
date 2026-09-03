import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { USERS_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { ProfileQuestionService } from "@/src/service/profile_question_service.ts";
import {
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Only the questions this member actually answered. An unanswered one is absent rather than
 * present and empty, so a profile with none of them answered shows no question section at all.
 */
const PROFILE_ANSWER_RESPONSE = z.object({
  questionId: z.uuidv7(),
  section: z.string(),
  prompt: z.string(),
  answer: z.string(),
});

export default new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/profile-answers",
    tags: [USERS_TAG],
    summary: "Read the optional profile questions this member answered",
    operationId: "getProfileAnswers",
    middleware: authenticated,
    request: { params: z.object({ userId: USER_SCHEMA.shape.id }) },
    responses: {
      [STATUS_CODE.OK]: {
        description: "The answered questions, by section and then by position",
        content: jsonContent(z.array(PROFILE_ANSWER_RESPONSE)),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Email address not verified",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { userId } = c.req.valid("param");
    return c.json(
      await ProfileQuestionService.listAnswersForUser(userId),
      STATUS_CODE.OK,
    );
  },
);
