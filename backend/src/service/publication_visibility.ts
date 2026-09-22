import { sql } from "kysely";
import type { User } from "@/src/service/user_service.ts";
import { mayAdministerPlatform } from "@/src/service/platform_authorization.ts";

/**
 * Wer welche Veröffentlichung sieht — Rundmails und offizielle Threads nach derselben Regel.
 * Setzt voraus, dass die Abfrage die Tabelle `publication` unter diesem Namen enthält.
 */

/**
 * Welche Einträge diese Person in Warteschlange und „Gesendete" sieht.
 *
 * - **Eine Administration** sieht alles.
 * - **Das Eigene** sieht jeder, auch wenn ihm der Absender später entzogen wurde oder eine
 *   Administration den Haken „nur für die Administration" gesetzt hat — sonst verschwände ein
 *   Entwurf vor der Person, die ihn geschrieben hat.
 * - **Was nur für die Administration ist**, sieht sonst niemand, auch die Moderation nicht.
 * - **Alles Übrige** sieht, wessen Rolle `see_whole_queue` hat (die Moderation), und sonst nur, was
 *   unter einem der eigenen Absender läuft — über die Rolle oder persönlich. Wer denselben Absender
 *   hat, sieht die Einträge des anderen darunter, samt Verfasser.
 *
 * **Im Backend, als Bedingung der Abfrage**, nicht als Filter danach: Was nicht gelesen wird, kann
 * auch in keiner Antwort landen.
 *
 * Der Absender „Admin" steht auf der Veröffentlichung als null oder als das Ur-Admin-Konto und in
 * `sender_grant` als null; der `CASE` bringt beides auf null.
 */
export function visibleTo(user: User) {
  if (mayAdministerPlatform(user.platformRole)) {
    return sql<boolean>`true`;
  }

  const seesWholeQueue = user.permissions.includes("see_whole_queue");

  return sql<boolean>`(
    publication.written_by = ${user.id}
    OR (
      NOT publication.administration_only
      AND (
        ${seesWholeQueue}
        OR EXISTS (
          SELECT 1
          FROM sender_grant AS grant_row
          WHERE grant_row.sender_user_id IS NOT DISTINCT FROM (
              CASE
                WHEN publication.send_as_user_id IS NULL
                  OR EXISTS (
                    SELECT 1 FROM "user" AS sender_account
                    WHERE sender_account.id = publication.send_as_user_id
                      AND sender_account.is_primordial_admin
                  )
                THEN NULL
                ELSE publication.send_as_user_id
              END
            )
            AND (grant_row.user_id = ${user.id} OR grant_row.role = ${user.platformRole})
        )
      )
    )
  )`;
}
