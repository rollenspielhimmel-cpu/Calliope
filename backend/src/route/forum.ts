import { OpenAPIHono } from "@hono/zod-openapi";
import manageStructure from "./forum/manage_structure.ts";
import listForumThreads from "./forum/list_forum_threads.ts";
import getForumThread from "./forum/get_forum_thread.ts";
import listForumPosts from "./forum/list_forum_posts.ts";
import writeForumPosts from "./forum/write_forum_posts.ts";
import moderateThread from "./forum/moderate_thread.ts";
import getForumOverview from "./forum/get_forum_overview.ts";

// One route per file, as the convention asks — and here it is load-bearing as well: two `query`
// routes chained onto one app leave the second one's body typed as `Record<string, unknown>`.
// The bare `/` goes last, after everything with a literal segment.
export default new OpenAPIHono()
  .route("/", manageStructure)
  .route("/", listForumThreads)
  .route("/", getForumThread)
  .route("/", listForumPosts)
  .route("/", writeForumPosts)
  .route("/", moderateThread)
  .route("/", getForumOverview);
