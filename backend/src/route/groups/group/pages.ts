import { pageBelongsToGroup } from "@/src/middleware/belongs_to_parent.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import createPage from "./pages/create_page.ts";
import listPages from "./pages/list_pages.ts";
import page from "./pages/page.ts";

const router = new OpenAPIHono();

// Gehört `pageId` zum Elternteil aus der Adresse? Eingehängt vor allen Routen und außerhalb der Kette:
// Jede Route darunter erbt es, auch eine künftige, und der Typ des Routers wächst nicht mit —
// siehe `belongs_to_parent.ts`.
router.use("/:pageId/*", pageBelongsToGroup);
router.use("/:pageId", pageBelongsToGroup);

export default router
  .route("/", createPage)
  .route("/", listPages)
  .route("/:pageId", page);
