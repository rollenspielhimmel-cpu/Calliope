import { assertEquals } from "@std/assert";
import { sendWhileWanted } from "@/src/service/broadcast_service.ts";

/**
 * Die Mails einer Rundmail: wenige Arbeiter, und vor jeder Mail die Frage, ob sie noch gewollt ist.
 *
 * **Warum ohne echten Versand:** Was hier zählt, ist die Reihenfolge von Fragen und Senden — und die
 * ließe sich mit einem Relais nur über die Zeit prüfen: zurückziehen, wenn ungefähr die Hälfte raus
 * ist. Das wäre ein Test, der je nach Last etwas anderes misst. Eine Attrappe für das Senden macht
 * ihn genau.
 */

/** Sendet nichts, zählt mit und lässt jede Mail einmal auf die Ereignisschleife warten. */
function recorder() {
  const sent: number[] = [];
  return {
    sent,
    async send(item: number) {
      await Promise.resolve();
      sent.push(item);
    },
  };
}

Deno.test("solange sie gewollt ist, gehen alle raus", async () => {
  const mail = recorder();

  const count = await sendWhileWanted(
    [1, 2, 3, 4, 5, 6, 7],
    mail.send,
    () => true,
  );

  assertEquals(count, 7);
  assertEquals(mail.sent.toSorted((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});

Deno.test("nach dem Zurückziehen geht keine weitere raus", async () => {
  const mail = recorder();
  let wanted = true;

  // Einer, damit die Grenze genau ist: Nach der dritten Mail wird zurückgezogen.
  const count = await sendWhileWanted(
    [1, 2, 3, 4, 5, 6, 7],
    async (item) => {
      await mail.send(item);
      if (mail.sent.length === 3) {
        wanted = false;
      }
    },
    () => wanted,
    1,
  );

  assertEquals(count, 3);
  assertEquals(mail.sent, [1, 2, 3]);
});

Deno.test("mit mehreren Arbeitern sind höchstens so viele noch unterwegs", async () => {
  const mail = recorder();
  let wanted = true;

  // Zurückgezogen, sobald die erste Mail raus ist. Die anderen vier Arbeiter haben ihre schon in
  // der Hand — mehr nicht. Das ist die Zusage an der Oberfläche: „höchstens fünf".
  const count = await sendWhileWanted(
    Array.from({ length: 50 }, (_, index) => index),
    async (item) => {
      await mail.send(item);
      wanted = false;
    },
    () => wanted,
    5,
  );

  assertEquals(count, 5);
});

Deno.test("eine Mail, die scheitert, hält die übrigen nicht auf", async () => {
  const mail = recorder();

  const count = await sendWhileWanted(
    [1, 2, 3],
    async (item) => {
      if (item === 2) {
        throw new Error("das Relais mag diese Adresse nicht");
      }
      await mail.send(item);
    },
    () => true,
    1,
  );

  assertEquals(count, 2);
  assertEquals(mail.sent, [1, 3]);
});
