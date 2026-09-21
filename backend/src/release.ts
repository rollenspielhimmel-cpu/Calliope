import type { MiddlewareHandler } from "hono";
import { getOptionalEnvVariable } from "@/src/util/env.ts";

/**
 * Der Stand, auf dem dieses Backend läuft.
 *
 * Von `deploy.sh` gestempelt — `git describe --always --dirty` —, und `docker-compose.deploy.yaml`
 * reicht dieselbe Variable an das Frontend weiter, wo sie als `VITE_COMMIT` in das Bündel wandert.
 * Beide Seiten tragen deshalb denselben Text, und Abweichung heißt wirklich Abweichung.
 *
 * **Leer, wenn niemand stempelt** — von Hand gestartet, im Testlauf, in der Entwicklung. Dann geht
 * die Kopfzeile unten gar nicht erst raus, und die Oberfläche hat nichts zu vergleichen. Das ist
 * die stille Antwort, nicht die falsche: Ohne zwei Stände gibt es keine Aussage über sie.
 */
export const RELEASE = getOptionalEnvVariable("GIT_COMMIT");

/**
 * Die Kopfzeile, an der ein offener Browser merkt, dass er veraltet ist.
 *
 * **An jeder Antwort statt als eigene Abfrage.** Ein Deploy tauscht das Backend aus, die offenen
 * Seiten behalten ihr JavaScript — eine Einseiten-Anwendung lädt sich nicht selbst nach. Nach dem
 * Start sind das Tage. Wer regelmäßig nachfragen wollte, müsste im Hintergrund abrufen; wer die
 * Kopfzeile mitschickt, bezahlt nichts, weil die Anfragen ohnehin laufen.
 *
 * Und wer nichts tut, erfährt nichts — mit Absicht: Ein alter Stand schadet niemandem, der gerade
 * nicht mit dem Server spricht.
 */
export const RELEASE_HEADER = "X-Release";

/**
 * Das Mittelstück, das sie anhängt.
 *
 * **Der Stand kommt als Wert herein und nicht aus der Umgebung**, damit ein Test ihn setzen kann.
 * Sonst wäre nur der stille Fall prüfbar — im Testlauf stempelt niemand —, und ausgerechnet die
 * Zusage, um die es geht, bliebe unbelegt.
 */
export function releaseHeader(release: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header(RELEASE_HEADER, release);
  };
}
