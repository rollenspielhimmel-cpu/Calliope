import { OpenAPIHono } from "@hono/zod-openapi";
import comments from "./status_update/comments.ts";

export default new OpenAPIHono().route("/comments", comments);
