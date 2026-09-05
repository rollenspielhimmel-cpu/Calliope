import { OpenAPIHono } from "@hono/zod-openapi";
import listFolders from "./forum/list_folders.ts";
import createFolder from "./forum/create_folder.ts";
import updateFolder from "./forum/update_folder.ts";
import moveFolder from "./forum/move_folder.ts";
import deleteFolder from "./forum/delete_folder.ts";
import setPermission from "./forum/set_permission.ts";
import moveThread from "./forum/move_thread.ts";
import movePage from "./forum/move_page.ts";
import listThreads from "./forum/list_threads.ts";
import createThread from "./forum/create_thread.ts";
import getThread from "./forum/get_thread.ts";
import listPosts from "./forum/list_posts.ts";
import createPost from "./forum/create_post.ts";
import updatePost from "./forum/update_post.ts";
import deletePost from "./forum/delete_post.ts";
import listPages from "./forum/list_pages.ts";
import createPage from "./forum/create_page.ts";
import getPage from "./forum/get_page.ts";
import updatePage from "./forum/update_page.ts";

/**
 * The public forum.
 *
 * Flatter than `groups.ts`, because there is no id in the path to mount everything under: the
 * forum is one of them, so its own routes carry the only parameters there are.
 *
 * **Every route here requires a session, reading included.** „Öffentlich" means in front of the
 * whole community rather than in front of the internet: a member sees what the folder's permission
 * lets them see, and somebody without an account sees nothing.
 *
 * This is deliberately kept as it arrived from upstream. The forum this replaced was readable
 * signed out, so the change is real and was made with open eyes rather than by omission — the
 * decision was to take Calliope's shape whole rather than to fork it on the first difference.
 *
 * **To revisit before the community opens.** A forum nobody can read without registering is also
 * a forum nobody can be shown before they decide to join, and that trade is worth weighing once
 * there is something in it worth showing. Reopening it would mean loosening the reads —
 * `list_threads`, `get_thread`, `list_posts`, `list_pages`, `get_page`, `list_folders` — to a
 * session-optional middleware, and teaching `forum_authorization.ts` what a reader without an
 * account may see. The writes stay as they are either way.
 */
export default new OpenAPIHono()
  .route("/folders", listFolders)
  .route("/folders", createFolder)
  .route("/folders/:folderId", updateFolder)
  .route("/folders/:folderId", deleteFolder)
  .route("/folders/:folderId/parent", moveFolder)
  .route("/permissions/:targetType/:targetId", setPermission)
  .route("/threads", listThreads)
  .route("/threads", createThread)
  .route("/threads/:threadId", getThread)
  .route("/threads/:threadId/folder", moveThread)
  .route("/threads/:threadId/posts", listPosts)
  .route("/threads/:threadId/posts", createPost)
  .route("/threads/:threadId/posts/:postId", updatePost)
  .route("/threads/:threadId/posts/:postId", deletePost)
  .route("/pages", listPages)
  .route("/pages", createPage)
  .route("/pages/:pageId", getPage)
  .route("/pages/:pageId", updatePage)
  .route("/pages/:pageId/folder", movePage);
