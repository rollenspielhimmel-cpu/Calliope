import { OpenAPIHono } from "@hono/zod-openapi";
import createStatusUpdate from "./status_updates/create_status_update.ts";
import listStatusUpdates from "./status_updates/list_status_updates.ts";
import statusUpdate from "./status_updates/status_update.ts";

export default new OpenAPIHono()
  .route("/", createStatusUpdate)
  .route("/", listStatusUpdates)
  .route("/:statusUpdateId", statusUpdate);
