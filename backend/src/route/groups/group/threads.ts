import { threadBelongsToGroup } from "@/src/middleware/belongs_to_parent.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import createThread from "./threads/create_thread.ts";
import listThreads from "./threads/list_threads.ts";
import thread from "./threads/thread.ts";

const router = new OpenAPIHono();

// Gehört `threadId` zum Elternteil aus der Adresse? Eingehängt vor allen Routen und außerhalb der Kette:
// Jede Route darunter erbt es, auch eine künftige, und der Typ des Routers wächst nicht mit —
// siehe `belongs_to_parent.ts`.
router.use("/:threadId/*", threadBelongsToGroup);
router.use("/:threadId", threadBelongsToGroup);

export default router
  .route("/", createThread)
  .route("/", listThreads)
  .route("/:threadId", thread);
