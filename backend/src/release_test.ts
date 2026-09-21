import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { RELEASE_HEADER, releaseHeader } from "@/src/release.ts";

/**
 * Die Kopfzeile, an der ein offener Browser merkt, dass er veraltet ist.
 *
 * **Warum das eigens geprüft wird:** Sie ist eine Verabredung über zwei Projekte hinweg — das
 * Backend schreibt sie, das Frontend liest sie in `lib/api/release.ts`. Verschreibt sich eine
 * Seite, bricht nichts: Es erscheint nur nie ein Hinweis, und niemand merkt es, bis wieder jemand
 * tagelang gegen ein Backend arbeitet, das seinen Stand nicht kennt.
 *
 * Im Testlauf stempelt `deploy.sh` nichts, deshalb nimmt das Mittelstück den Stand als Wert
 * entgegen — sonst wäre hier nur der stille Fall zu prüfen.
 */

Deno.test("jede Antwort trägt den Stand des Backends", async () => {
  const app = new Hono()
    .use(releaseHeader("abc1234"))
    .get("/", (c) => c.text("ok"));

  const response = await app.request("/");

  assertEquals(response.headers.get(RELEASE_HEADER), "abc1234");
  await response.text();
});

Deno.test("auch eine Absage trägt ihn", async () => {
  // Wer nach einem Deploy in eine Ablehnung läuft, die sein alter Stand nicht kennt, soll genau
  // daraus erfahren, dass er neu laden muss — also hängt sie an der Antwort und nicht am Erfolg.
  const app = new Hono()
    .use(releaseHeader("abc1234"))
    .get("/", (c) => c.json({ error: "nein" }, 403));

  const response = await app.request("/");

  assertEquals(response.status, 403);
  assertEquals(response.headers.get(RELEASE_HEADER), "abc1234");
  await response.json();
});

Deno.test("der Name ist der, den das Frontend liest", () => {
  // `lib/api/release.ts` vergleicht kleingeschrieben, weil `Headers` so nachschlägt. Steht hier
  // etwas anderes, erscheint der Hinweis nie — und das fällt sonst niemandem auf.
  assertEquals(RELEASE_HEADER.toLowerCase(), "x-release");
});
