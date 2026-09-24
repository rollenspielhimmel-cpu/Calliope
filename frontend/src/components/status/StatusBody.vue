<script setup lang="ts">
/**
 * Der Text einer Statusmeldung, gekürzt auf den Platz, den er bekommt.
 *
 * **Eine Meldung darf vier Tausend Zeichen lang sein.** Ungekürzt nimmt eine einzige davon den
 * ganzen Kasten ein und verdrängt alles andere — man sieht dann eine Meldung statt zehn.
 *
 * **Gemessen, nicht gezählt.** Die Kürzung fragt das Element selbst, ob der Text noch hineinpasst,
 * statt Zeichen zu zählen — siehe `lib/text/shortenToFit.ts`. Eine Meldung, die passt, steht ganz
 * da, ohne „…" und ohne „weiterlesen": Ein Angebot, das zu dem führt, was man schon gelesen hat,
 * ist ein kleiner Betrug.
 *
 * **Aufgeklappt wird an Ort und Stelle**, mit einem Weg zurück. Ohne „weniger" ließe sich eine
 * einmal aufgeklappte Meldung nicht wieder wegräumen, und der Kasten hat feste Höhe.
 */
import { ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { shortenToFit } from '@/lib/text/shortenToFit'

const props = defineProps<{
  text: string
  /** Wie viele Zeilen stehen bleiben, bevor gekürzt wird. Der Ort entscheidet, nicht der Text. */
  lines: number
}>()

/**
 * Der Absatz ist sein eigenes Maßband: Die Höhendeckelung und `overflow-hidden` halten ihn dort,
 * wie viel Text auch darin steht — `scrollHeight` größer als `clientHeight` heißt also genau, dass
 * dieser Text nicht hineinpasst.
 *
 * Während der Suche wird in `textContent` geschrieben statt über den Verweis: Jeder Kandidat muss
 * gemessen sein, bevor der nächste gewählt wird, und Vue trägt einen Verweis erst im nächsten
 * Durchgang ein. Der Endwert geht anschließend durch den Verweis, damit Gezeichnetes und Zustand
 * übereinstimmen.
 */
const body = ref<HTMLElement | null>(null)

const shown = ref<string>(props.text)
const wasCut = ref<boolean>(false)
const expanded = ref<boolean>(false)

/** In `em`, damit die Deckelung der Schriftgröße folgt. `leading-snug` ist 1.375. */
const LINE_HEIGHT = 1.375

function refit() {
  const element = body.value

  // Aufgeklappt gibt es nichts zu messen: Dann steht alles da, und die Deckelung ist weg.
  if (element === null || expanded.value) {
    return
  }

  const result = shortenToFit(props.text, (candidate) => {
    element.textContent = candidate
    return element.scrollHeight <= element.clientHeight
  })

  element.textContent = result.text
  shown.value = result.text
  wasCut.value = result.wasCut
}

// Nicht `onMounted`: Der Absatz entsteht erst, wenn er gezeichnet wird, und im Kasten wird eine
// Meldung auch nachgeladen. Der Verweis selbst ist das Signal.
watch(body, refit, { immediate: true })

// Ein schmalerer Kasten fasst weniger Wörter, und die Seitenleiste klappt ein und aus, ohne dass
// das Fenster sich ändert — deshalb wird das Element beobachtet und nicht die Sichtfläche.
useResizeObserver(body, refit)

watch(() => [props.text, props.lines], refit)

function toggle() {
  expanded.value = !expanded.value
  if (!expanded.value) {
    // Zusammengeklappt muss neu gemessen werden: Die Deckelung ist wieder da.
    void Promise.resolve().then(refit)
  }
}
</script>

<template>
  <div>
    <p
      ref="body"
      class="text-sm leading-snug whitespace-pre-wrap text-ink-2"
      :class="expanded ? '' : 'overflow-hidden'"
      :style="expanded ? undefined : { maxHeight: `${lines * LINE_HEIGHT}em` }"
    >
      {{ expanded ? text : shown }}
    </p>

    <button
      v-if="wasCut"
      type="button"
      class="mt-0.5 text-[11.5px] font-medium text-oak-deep underline-offset-[4px] hover:underline"
      @click="toggle"
    >
      {{ expanded ? 'weniger' : 'weiterlesen' }}
    </button>
  </div>
</template>
