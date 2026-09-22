import { folderBelongsToGroup } from "@/src/middleware/belongs_to_parent.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import createFolder from "./folders/create_folder.ts";
import listFolders from "./folders/list_folders.ts";
import folder from "./folders/folder.ts";

const router = new OpenAPIHono();

// Gehört `folderId` zum Elternteil aus der Adresse? Eingehängt vor allen Routen und außerhalb der Kette:
// Jede Route darunter erbt es, auch eine künftige, und der Typ des Routers wächst nicht mit —
// siehe `belongs_to_parent.ts`.
router.use("/:folderId/*", folderBelongsToGroup);
router.use("/:folderId", folderBelongsToGroup);

export default router
  .route("/", createFolder)
  .route("/", listFolders)
  .route("/:folderId", folder);
