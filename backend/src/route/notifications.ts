import { OpenAPIHono } from "@hono/zod-openapi";
import listNotifications from "./notifications/list_notifications.ts";
import readNotifications from "./notifications/read_notifications.ts";
import readBroadcast from "./notifications/read_broadcast.ts";

export default new OpenAPIHono()
  .route("/", listNotifications)
  .route("/read", readNotifications)
  // Unter den Benachrichtigungen und nicht unter der Verwaltung, weil die Zugehörigkeit hier
  // entschieden wird: Man liest die Rundmail, weil man sie im Postfach hat.
  .route("/broadcast", readBroadcast);
