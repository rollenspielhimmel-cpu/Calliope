import { OpenAPIHono } from "@hono/zod-openapi";
import createGroup from "./groups/create_group.ts";
import listGroups from "./groups/list_groups.ts";
import group from "./groups/group.ts";
import maskPseudonymousGroup from "@/src/middleware/mask_pseudonymous_group.ts";

export default new OpenAPIHono()
  .route("/", createGroup)
  .route("/", listGroups)
  // Before the subtree rather than inside it: everything a group serves passes here, including
  // routes that do not exist yet. See the middleware for what that buys and what it does not.
  .use("/:groupId/*", maskPseudonymousGroup)
  .use("/:groupId", maskPseudonymousGroup)
  .route("/:groupId", group);
