import type { Ref } from 'vue'
import { ref } from 'vue'
import { COMMIT } from '@/lib/branding'

/**
 * Ob das Backend auf einem anderen Stand läuft als diese Seite.
 *
 * **Ein Deploy tauscht den Server aus, nicht die offenen Browser.** Eine Einseiten-Anwendung lädt
 * sich nicht selbst nach: Wer die Seite offen hat, behält das JavaScript, mit dem er sie geladen
 * hat — nach dem Start sind das Tage. Neues Backend und alter Client sprechen dann miteinander,
 * und eine Antwort, die der alte Stand nicht kennt, lässt ihn still etwas Falsches tun. Genau so
 * ist es passiert: Der Server leitete eine Einladung um, der alte Client kannte den Fall nicht und
 * erneuerte die Mitgliederliste eines Gesprächs, das es nicht mehr gab.
 *
 * Bemerkt wird es an einer Kopfzeile, die jede Antwort ohnehin mitbringt — kein Abrufen im
 * Hintergrund. Wer nichts tut, erfährt nichts, und das ist richtig: Ein alter Stand schadet
 * niemandem, der gerade nicht mit dem Server spricht.
 */
export const backendIsNewer: Ref<boolean> = ref(false)

/** Dieselbe Kopfzeile wie in `backend/src/release.ts`. */
const RELEASE_HEADER = 'x-release'

/**
 * **Einmal gesetzt, bleibt es gesetzt.** Zurückzuspringen hieße zu behaupten, der Stand sei wieder
 * gleich — das wird er in diesem Tab nicht mehr.
 *
 * **Und still, solange einer der beiden Stände fehlt.** In der Entwicklung stempelt niemand, dann
 * ist `COMMIT` „unknown" und die Kopfzeile bleibt aus. Ohne zwei Stände gibt es keine Aussage über
 * sie; eine Warnung wäre dort reines Rauschen.
 */
export function noteRelease(headers: Headers): void {
  const backend = headers.get(RELEASE_HEADER)

  if (backend !== null && COMMIT !== 'unknown' && backend !== COMMIT) {
    backendIsNewer.value = true
  }
}
