import { OpenAPIHono } from "@hono/zod-openapi";
import banUser from "./user/ban_user.ts";
import getUser from "./user/get_user.ts";
import getProfileAnswers from "./user/get_profile_answers.ts";

export default new OpenAPIHono()
  .route("/", getUser)
  .route("/", banUser)
  .route("/", getProfileAnswers);
