<script setup lang="ts">
/**
 * Der Text einer Chatnachricht, lange Nachrichten angeschnitten.
 *
 * **Nötig geworden, weil eine Rundmail bis zu 10.000 Zeichen lang sein darf, eine gewöhnliche
 * Nachricht aber nur 4.000.** Die Grenze liegt dort, wo sie einen Zweck hat: Für eine private
 * Nachricht unter Mitgliedern ist sie sinnvoll, für eine Ankündigung des Teams an alle wäre sie
 * eine Fessel ohne Grund — Regeländerungen und Wartungshinweise werden genau so lang. Dass ein
 * Verlauf davon nicht zur Wand wird, ist eine Frage der Anzeige und kein Grund, Inhalte zu kürzen.
 *
 * **Ohne Messung, anders als bei den Blind-Date-Handlungen.** Die schneiden auf eine Höhe zu, weil
 * sie in einen festen Kasten müssen; eine Nachricht darf so hoch werden, wie sie will. Hier reicht
 * eine Zeichenzahl — und `cutAtWord` schneidet an der Wortgrenze, statt mitten hinein.
 *
 * Das „…" erscheint deshalb nur, wenn wirklich etwas fehlt: Ist der Text kürzer als die Grenze,
 * steht er ungekürzt da und es gibt keinen Knopf.
 */
import { computed, ref } from 'vue'
import { cutAtWord, ELLIPSIS } from '@/lib/blindDate/truncate'

const { text } = defineProps<{ text: string }>()

/**
 * Ab wann angeschnitten wird.
 *
 * Großzügig gewählt: Die allermeisten Nachrichten bleiben weit darunter und dürfen sich gar nicht
 * erst wie etwas anfühlen, das man aufklappen muss. Getroffen wird die lange Ankündigung, für die
 * es diese Datei gibt.
 */
const LIMIT = 1200

const expanded = ref<boolean>(false)

const isLong = computed<boolean>(() => text.length > LIMIT)

const shown = computed<string>(() =>
  !isLong.value || expanded.value ? text : cutAtWord(text, LIMIT) + ELLIPSIS,
)
</script>

<template>
  <div>
    <!-- `whitespace-pre-wrap`, damit Absätze bleiben, wie sie getippt wurden. -->
    <p class="text-note whitespace-pre-wrap text-ink-2">{{ shown }}</p>

    <button
      v-if="isLong"
      type="button"
      class="mt-1 flex min-h-11 items-center text-[12px] text-ink-5 hover:text-oak-deep md:min-h-0"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Weniger anzeigen' : 'Weiterlesen' }}
    </button>
  </div>
</template>
