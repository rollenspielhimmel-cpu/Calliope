import { OpenAPIHono } from "@hono/zod-openapi";
import comments from "./status_update/comments.ts";
import notifications from "./status_update/notifications.ts";

export default new OpenAPIHono()
  .route("/comments", comments)
  .route("/notifications", notifications);
