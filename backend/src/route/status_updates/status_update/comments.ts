import { OpenAPIHono } from "@hono/zod-openapi";
import listComments from "./comments/list_comments.ts";
import createComment from "./comments/create_comment.ts";

export default new OpenAPIHono()
  .route("/", listComments)
  .route("/", createComment);
