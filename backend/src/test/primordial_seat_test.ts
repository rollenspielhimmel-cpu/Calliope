import { assertEquals } from "@std/assert";
import { db } from "@/src/database/client.ts";
import {
  borrowPrimordialSeat,
  returnPrimordialSeat,
  withVacantPrimordialSeat,
} from "@/src/test/primordial_seat.ts";
import {
  ensureRootAdmin,
  ROOT_ADMIN_USERNAME,
} from "@/src/service/root_admin_service.ts";
import { deleteUsers, registerUser, write } from "@/src/test/support.ts";

/**
 * Die Vorrichtung für den Ur-Admin-Platz, an ihrer heikelsten Stelle.
 *
 * **Warum sie einen eigenen Test hat:** Sie ist die Sperre, auf die sich fünf Dateien verlassen, und
 * sie war zweimal falsch, ohne dass einer ihrer Nutzer es direkt gezeigt hätte. Sichtbar wurde es
 * jedes Mal als ein fremder Test, der „manchmal" rot war — hier zuletzt `admin_inbox_test.ts`, zwei
 * von fünf vollen Läufen.
 */

const STANDIN = "ps-standin";
const BORROWER = "ps-borrower";

async function holder(): Promise<string | undefined> {
  const row = await db
    .selectFrom("user")
    .select("username")
    .where("isPrimordialAdmin", "=", true)
    .executeTakeFirst();

  return row?.username;
}

/**
 * **Solange der Platz mit Absicht leer steht, leiht ihn niemand.**
 *
 * Der Rumpf prüft das Hochfahren, und das Hochfahren legt ein neues `Admin` an. Für die Vorrichtung
 * hieß „frei" aber: `Admin` hält den Platz. Ein wartender Leiher übernahm ihn deshalb mitten im
 * Rumpf, und das Zurückgeben am Ende nahm ihn ihm wieder weg — sein Test lief ohne Platz weiter und
 * glaubte, ihn zu haben.
 */
Deno.test("nobody borrows the seat while it is empty on purpose", async () => {
  await deleteUsers([BORROWER]);
  await registerUser(BORROWER);
  // Den Platz darf nur halten, wer Administrator ist (`user_primordial_admin_is_an_administrator`).
  await write((transaction) =>
    transaction
      .updateTable("user")
      .set({ platformRole: "administrator" })
      .where("username", "=", BORROWER)
      .execute()
  );

  let borrowed = false;
  let lent: Promise<void> | undefined;

  try {
    await withVacantPrimordialSeat(
      async () => {
        await write((transaction) =>
          transaction
            .updateTable("user")
            .set({
              username: STANDIN,
              emailAddress: `${STANDIN}@example.invalid`,
              isPrimordialAdmin: false,
            })
            .where("username", "=", ROOT_ADMIN_USERNAME)
            .execute()
        );
      },
      async () => {
        await write((transaction) =>
          transaction
            .deleteFrom("user")
            .where("username", "=", ROOT_ADMIN_USERNAME)
            .execute()
        );

        await write((transaction) =>
          transaction
            .updateTable("user")
            .set({
              username: ROOT_ADMIN_USERNAME,
              emailAddress: "admin@rollenspielhimmel.invalid",
              isPrimordialAdmin: true,
            })
            .where("username", "=", STANDIN)
            .execute()
        );
      },
      async () => {
        Deno.env.set("ROOT_ADMIN_PASSWORD", "a-seat-test-password");
        await ensureRootAdmin();

        // Das ist die Lage, die der Leiher für „frei" hielt.
        assertEquals(await holder(), ROOT_ADMIN_USERNAME);

        lent = borrowPrimordialSeat(BORROWER).then(() => {
          borrowed = true;
        });

        // Eine Sekunde ist das Zwanzigfache dessen, was ein Leihen braucht, wenn der Platz frei
        // ist. Gewartet wird hier nicht auf ein Ereignis, sondern auf dessen Ausbleiben — das lässt
        // sich nur mit einer Frist belegen.
        await new Promise((resolve) => setTimeout(resolve, 1000));

        assertEquals(borrowed, false, "mitten im Rumpf geliehen");
        assertEquals(await holder(), ROOT_ADMIN_USERNAME);
      },
    );

    // Und danach bekommt er ihn doch: Warten heißt warten, nicht aufgeben.
    await lent;
    assertEquals(borrowed, true);
    assertEquals(await holder(), BORROWER);
  } finally {
    await lent?.catch(() => {});
    await returnPrimordialSeat(BORROWER);
    await deleteUsers([BORROWER]);
  }
});
