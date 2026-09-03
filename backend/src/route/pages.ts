import { OpenAPIHono } from "@hono/zod-openapi";
import managePages from "./pages/manage_pages.ts";
import readPage from "./pages/read_page.ts";

// Reading one page is open to anybody the page allows; everything else is administrator only,
// which is why the two files are separate rather than one with mixed guards.
export default new OpenAPIHono()
  .route("/", managePages)
  .route("/", readPage);
