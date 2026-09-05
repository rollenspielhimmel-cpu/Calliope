import { BroadcastQueueService } from "./service/broadcast_queue_service.ts";
import { ActivityService } from "./service/activity_service.ts";
import { UserAvatarService } from "./service/user_avatar_service.ts";
import { UserTokenService } from "./service/user_token_service.ts";
import { UserService } from "./service/user_service.ts";
import { getAbortSignalForShutdown } from "./util/abort_signal.ts";

export function scheduleCronJobs() {
  Deno.cron(
    "Delete expired sessions",
    "0 * * * *",
    { signal: getAbortSignalForShutdown() },
    async () => {
      const deletedSessions = await UserService.deleteExpiredSessions();
      console.log(`Deleted ${deletedSessions} expired session(s)`);
    },
  );

  // Daily rather than hourly: nothing is waiting on it, and what it deletes has been unreferenced
  // for longer than the backups are kept.
  Deno.cron(
    "Delete unreferenced files",
    "15 4 * * *",
    { signal: getAbortSignalForShutdown() },
    async () => {
      const deletedFiles = await UserAvatarService.sweepUnreferencedFiles();
      console.log(`Deleted ${deletedFiles} unreferenced file(s)`);
    },
  );

  // Nightly, and off the hour like the file sweep: nothing waits on it, and what it deletes is
  // already past what any question may reach.
  Deno.cron(
    "Delete activity windows past their retention",
    "45 4 * * *",
    { signal: getAbortSignalForShutdown() },
    async () => {
      const deleted = await ActivityService.deleteWindowsOlderThanRetention();
      console.log(`Deleted ${deleted} activity window(s)`);
    },
  );

  Deno.cron(
    "Delete expired user tokens",
    "30 * * * *",
    { signal: getAbortSignalForShutdown() },
    async () => {
      const deletedTokens = await UserTokenService.deleteExpiredTokens();
      console.log(`Deleted ${deletedTokens} expired user token(s)`);
    },
  );

  /**
   * **Jede Minute**, als einzige Aufgabe hier — und das ist der Punkt.
   *
   * „Sonntag um 20 Uhr" heißt für jemanden, der es eintippt, Sonntag um 20 Uhr. Ein stündlicher
   * Lauf würde daraus „irgendwann zwischen 20 und 21 Uhr", und eine Ankündigung, die eine
   * Dreiviertelstunde nach der angekündigten Zeit eintrifft, ist keine Ankündigung mehr. Die
   * Abfrage kostet nichts: Ein Teilindex über `scheduled_for WHERE status = 'approved'` beantwortet
   * sie, und in aller Regel ist die Antwort leer.
   *
   * Die Zeitzone steht nicht hier. Der Termin liegt in UTC in der Spalte, verglichen wird mit der
   * Uhr der Datenbank; Europe/Berlin ist eine Sache der Oberfläche, die den eingetippten Zeitpunkt
   * umrechnet. Ein Taktgeber, der Zeitzonen kennt, wäre eine zweite Stelle, an der die Sommerzeit
   * falsch sein kann.
   *
   * Nichts wird protokolliert, wenn nichts anlag: Eine Zeile pro Minute wäre ein Logbuch, in dem
   * das Seltene nicht mehr auffällt.
   */
  Deno.cron(
    "Release due broadcasts",
    "* * * * *",
    { signal: getAbortSignalForShutdown() },
    async () => {
      const sent = await BroadcastQueueService.releaseDue();

      if (sent > 0) {
        console.log(`Released ${sent} due broadcast(s)`);
      }
    },
  );
}
