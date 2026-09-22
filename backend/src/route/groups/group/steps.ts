import { stepBelongsToGroup } from "@/src/middleware/belongs_to_parent.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import createStep from "./steps/create_step.ts";
import listSteps from "./steps/list_steps.ts";
import step from "./steps/step.ts";

const router = new OpenAPIHono();

// Gehört `stepId` zum Elternteil aus der Adresse? Eingehängt vor allen Routen und außerhalb der Kette:
// Jede Route darunter erbt es, auch eine künftige, und der Typ des Routers wächst nicht mit —
// siehe `belongs_to_parent.ts`.
router.use("/:stepId/*", stepBelongsToGroup);
router.use("/:stepId", stepBelongsToGroup);

export default router
  .route("/", createStep)
  .route("/", listSteps)
  .route("/:stepId", step);
