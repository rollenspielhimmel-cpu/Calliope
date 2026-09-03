import { createMiddleware } from "hono/factory";
import { STATUS_CODE } from "@std/http/status";
import type { User } from "@/src/service/user_service.ts";
import { BlindDateAccessService } from "@/src/service/blind_date_access_service.ts";

/**
 * Guards the whole Blind-Date desk, listed after an authentication middleware:
 *
 *     middleware: [authenticated, authorizedForBlindDate] as const,
 *
 * The `as const` is load-bearing — see AGENTS.md.
 *
 * **Every route of that area, not only the queue.** Applications, offers, exclusions, the
 * participation table and the feedback are all one desk, and a right that covered four of five
 * would be a right nobody could reason about. A route added there later inherits nothing by itself,
 * which is why they are listed together and why the test beside them names every one.
 *
 * 403 with a reason, so the page can say which door is shut rather than only that one is. The menu
 * entry stays visible for everybody on the team on purpose: an entry that disappears is a feature
 * people ask about, and one that explains itself answers the question.
 *
 * This costs one query — whether the member has an application of their own that is still open —
 * and only for somebody who already holds the right. The two cheap conditions are read off the
 * session user.
 */
export const authorizedForBlindDate = createMiddleware<
  { Variables: { user: User } }
>(async (c, next) => {
  // Defensive: reachable only by listing this without an authentication middleware before it,
  // which would otherwise throw on undefined and answer 500 instead of refusing.
  const user = c.get("user") as User | undefined;

  if (user === undefined) {
    return c.json({ error: "Unauthorized" }, STATUS_CODE.Unauthorized);
  }

  const access = await BlindDateAccessService.accessFor(user);

  if (!access.granted) {
    return c.json(
      { error: "Forbidden", reason: access.refusal },
      STATUS_CODE.Forbidden,
    );
  }

  await next();
  return;
});
