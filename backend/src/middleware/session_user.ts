import type { Context } from "hono";
import { db } from "@/src/database/client.ts";
import { type User, UserService } from "@/src/service/user_service.ts";
import { SessionCookieService } from "@/src/service/session_cookie_service.ts";
import { ActivityService } from "@/src/service/activity_service.ts";

/**
 * Shared by the two session middlewares, which differ only in whether they also insist the
 * address has been verified. One copy, so a change to how a session is read cannot apply to
 * the strict path and not the permissive one.
 */
export async function resolveSessionUser(
  c: Context,
): Promise<User | undefined> {
  const sessionToken = SessionCookieService.getUserSession(c);

  if (sessionToken === undefined) {
    return undefined;
  }

  const found = await UserService.selectUserForSession(sessionToken);

  if (found === undefined) {
    SessionCookieService.deleteUserSession(c);
    return undefined;
  }

  const { user, needsRefresh, sessionId } = found;

  // Die Sitzung verlängert sich selten — einmal je Auffrischungsfenster. Die Transaktion öffnet
  // deshalb nur, wer wirklich schreibt.
  if (needsRefresh) {
    await db.transaction().execute((transaction) =>
      UserService.refreshSession(transaction, sessionId)
    );
  }

  // Here rather than in a middleware of its own: this is the one place every signed-in request
  // already passes through, and a second middleware would have to be listed on sixty routes with
  // every omission a silent hole — the argument `authenticated` makes for not decomposing.
  //
  // Awaited rather than left to run on its own. It is one statement per member per fifteen
  // minutes thanks to the memo, and a floating promise here would be an unhandled rejection
  // whenever the database is unwell.
  if (ActivityService.needsRecording(user.id)) {
    await db.transaction().execute((transaction) =>
      ActivityService.recordActivity(transaction, user.id)
    );
  }

  return user;
}
