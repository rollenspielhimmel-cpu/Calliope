import { postBelongsToThread } from "@/src/middleware/belongs_to_parent.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import createPost from "./posts/create_post.ts";
import listPosts from "./posts/list_posts.ts";
import post from "./posts/post.ts";

const router = new OpenAPIHono();

// Gehört `postId` zum Elternteil aus der Adresse? Eingehängt vor allen Routen und außerhalb der Kette:
// Jede Route darunter erbt es, auch eine künftige, und der Typ des Routers wächst nicht mit —
// siehe `belongs_to_parent.ts`.
router.use("/:postId/*", postBelongsToThread);
router.use("/:postId", postBelongsToThread);

export default router
  .route("/", createPost)
  .route("/", listPosts)
  .route("/:postId", post);
