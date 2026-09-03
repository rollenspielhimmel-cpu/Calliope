import { OpenAPIHono } from "@hono/zod-openapi";
import updateOwnProfile from "./me/update_own_profile.ts";
import setAvatar from "./me/set_avatar.ts";
import deleteAvatar from "./me/delete_avatar.ts";
import setProfileAnswers from "./me/set_profile_answers.ts";

// Everything a member does to their own account, so `/me` is mounted once.
export default new OpenAPIHono()
  .route("/", updateOwnProfile)
  .route("/", setAvatar)
  .route("/", deleteAvatar)
  .route("/", setProfileAnswers);
