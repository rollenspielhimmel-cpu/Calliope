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
 * **Das Angebot steht im Text, nicht darunter.** Sonst endet die letzte Zeile nach zwei Wörtern und
 * „… weiterlesen" bekommt eine eigene Zeile für sich — eine ganze Zeile für zwei Wörter, in einem
 * Kasten, in dem jede zählt. Deshalb wird in zwei Durchgängen gemessen: erst, ob der ganze Text
 * ohne Angebot hineinpasst; wenn nicht, mit dem Angebot im Absatz, damit die Suche dessen Breite
 * kennt und der Text genau dort endet, wo noch Platz dafür ist.
 *
 * **Linksbündig, auch im Kasten.** Mittig wurde zweimal probiert und zweimal verworfen:
 * Fließtext zerfällt so in Zeilen, die jede für sich anfangen. Seit der Text über die volle
 * Breite läuft und das Angebot in der letzten Zeile steht, gibt es dafür auch keinen Anlass mehr
 * — die Zeilen füllen sich von selbst.
 *
 * **Aufgeklappt wird an Ort und Stelle**, mit einem Weg zurück. Ohne „weniger" ließe sich eine
 * einmal aufgeklappte Meldung nicht wieder wegräumen, und der Kasten hat feste Höhe.
 */
import { nextTick, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { shortenToFit } from '@/lib/text/shortenToFit'

const props = withDefaults(
  defineProps<{
    text: string
    /** Wie viele Zeilen stehen bleiben, bevor gekürzt wird. Der Ort entscheidet, nicht der Text. */
    lines: number
    /**
     * Die Schriftgröße, als eine Klasse.
     *
     * **Eine Angabe, nicht zwei.** Sie von außen dazuzugeben ginge auch — nur stünden dann zwei
     * Schriftgrößen am selben Absatz, und welche gewinnt, entscheidet die Reihenfolge im
     * Stylesheet statt der Absicht. Im Zitat ist es kleiner als im Meldungstext; hier steht, wer
     * das bestimmt.
     */
    size?: string
  }>(),
  { size: 'text-sm' },
)

/**
 * Der Absatz ist sein eigenes Maßband: Die Höhendeckelung und `overflow-hidden` halten ihn dort,
 * wie viel Text auch darin steht — `scrollHeight` größer als `clientHeight` heißt also genau, dass
 * dieser Text nicht hineinpasst.
 *
 * Gemessen wird der Absatz, geschrieben wird in die Spanne darin: So zählt die Breite des Angebots
 * mit, das daneben steht. Während der Suche geht der Text direkt in `textContent` statt über den
 * Verweis — jeder Kandidat muss gemessen sein, bevor der nächste gewählt wird, und Vue trägt einen
 * Verweis erst im nächsten Durchgang ein.
 */
const body = ref<HTMLElement | null>(null)
const textSpan = ref<HTMLElement | null>(null)

const shown = ref<string>(props.text)
const wasCut = ref<boolean>(false)
const expanded = ref<boolean>(false)

/** In `em`, damit die Deckelung der Schriftgröße folgt. `leading-snug` ist 1.375. */
const LINE_HEIGHT = 1.375

async function refit() {
  // Aufgeklappt gibt es nichts zu messen: Dann steht alles da, und die Deckelung ist weg.
  if (expanded.value) {
    return
  }

  // Erster Durchgang: ohne Angebot, denn es soll keines geben, wenn alles hineinpasst.
  wasCut.value = false
  shown.value = props.text
  await nextTick()

  const element = body.value
  const span = textSpan.value
  if (element === null || span === null) {
    return
  }

  span.textContent = props.text
  if (element.scrollHeight <= element.clientHeight) {
    return
  }

  // Zweiter Durchgang: Das Angebot steht jetzt im Absatz, also kennt die Suche seine Breite.
  wasCut.value = true
  await nextTick()

  const result = shortenToFit(props.text, (candidate) => {
    span.textContent = candidate
    return element.scrollHeight <= element.clientHeight
  })

  span.textContent = result.text
  shown.value = result.text
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
    void refit()
  }
}
</script>

<template>
  <!-- prettier-ignore -->
  <p
    ref="body"
    class="leading-snug whitespace-pre-wrap text-ink-2"
    :class="[size, expanded ? '' : 'overflow-hidden']"
    :style="expanded ? undefined : { maxHeight: `${lines * LINE_HEIGHT}em` }"
  ><span ref="textSpan">{{ expanded ? text : shown }}</span><button
      v-if="wasCut"
      type="button"
      class="font-medium whitespace-nowrap text-oak-deep underline-offset-[3px] hover:underline"
      @click="toggle"
    >&nbsp;{{ expanded ? 'weniger' : 'weiterlesen' }}</button></p>
</template>
