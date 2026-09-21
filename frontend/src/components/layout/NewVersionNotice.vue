<script setup lang="ts">
/**
 * Ein ruhiger Satz, wenn das Backend weiter ist als diese Seite.
 *
 * **Nie von selbst neu laden.** Wer gerade eine lange Nachricht tippt, verlöre sie — und zwar in
 * dem Moment, in dem die Seite behauptet, sie helfe. Der Hinweis fragt, er handelt nicht.
 *
 * **Und nicht wegklickbar.** Wer ihn schließt und den Tab drei Tage offen lässt, ist genau wieder
 * im Ausgangsproblem, nur ohne Hinweis. Dafür ist er leise: eine Zeile, die stille Füllung, keine
 * Farbe, die warnt. Er erscheint ohnehin nur, wenn er recht hat.
 */
import { backendIsNewer } from '@/lib/api/release'

function reload() {
  globalThis.location.reload()
}
</script>

<template>
  <div
    v-if="backendIsNewer"
    class="flex items-baseline gap-2 border-b border-line-4 bg-paper-3 px-gutter py-1.5 text-[12.5px] text-ink-3 md:px-10"
  >
    Eine neue Fassung ist da. Lade die Seite neu, damit sie ankommt.
    <button
      type="button"
      class="min-h-11 font-medium text-oak-deep hover:underline md:min-h-0"
      @click="reload"
    >
      Neu laden
    </button>
  </div>
</template>
