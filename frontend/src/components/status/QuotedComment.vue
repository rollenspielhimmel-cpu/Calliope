<script setup lang="ts">
/**
 * Eine Antwort mit dem Kommentar darüber, auf den sie sich bezieht.
 *
 * **Eine Zeile, dann die Antwort.** Oben „↩ Antwort auf federkiel „Mir geht es gerade …"", direkt
 * darunter, in derselben Box, was man selbst geschrieben hat. Die beiden gehören zusammen und
 * sehen jetzt auch so aus.
 *
 * **Warum der Wortlaut mit in die Zeile muss:** Derselbe Mensch schreibt unter einer Meldung oft
 * mehrmals. Ein Name allein sagt dann nicht, welcher der drei Kommentare gemeint ist — die ersten
 * Wörter sagen es.
 *
 * **Es wird aus dem Bezug gebaut, nicht aus einer Kopie.** Deshalb stimmt das Zitat weiterhin,
 * wenn jemand seinen Kommentar ändert, und der Name steht sofort richtig da, wenn jemand sich
 * umbenennt. Vorher stand beides als `@name: „die ersten 60 Zeichen …"` im Text der Antwort —
 * eingefroren, nicht verlinkbar, und hinter dem „…" stand nichts mehr.
 *
 * Dieselbe Komponente dient zweimal: über dem Eingabefeld, solange die Antwort getippt wird, und
 * über der fertigen Antwort. Der Unterschied ist ein Kreuz zum Verwerfen, sonst nichts — was man
 * zitiert, soll beim Schreiben genauso aussehen wie danach.
 */
import { RouterLink } from 'vue-router'
import { Reply, X } from '@lucide/vue'

defineProps<{
  quoted: { id: string; body: string; createdBy: string; createdByUsername: string }
  /** Zeigt das Kreuz zum Verwerfen — nur solange das Zitat noch ein Entwurf ist. */
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <div class="rounded-md border-l-2 border-line-2 bg-paper-2 py-1 pr-1 pl-2">
    <div class="flex items-center gap-1">
      <!--
        **Eine Zeile, abgeschnitten vom Browser.** Sonst misst diese Oberfläche selbst, wie viel
        Text passt — hier nicht: Bei genau einer Zeile kann `truncate` es, es setzt das „…" selbst,
        und niemand muss wissen, *ob* gekürzt wurde. `min-w-0`, damit der Text im Flex-Kasten
        überhaupt schrumpfen darf; ohne das schöbe er den Rest hinaus.

        Das schließende Anführungszeichen steht außerhalb des gekürzten Teils, damit der Browser
        es nicht mitabschneidet: Ein Zitat endet auf …“ und nicht mit einem Anfang, der offen
        bleibt.
      -->
      <Reply :size="11" :stroke-width="1.75" class="shrink-0 text-ink-4" aria-hidden="true" />
      <span class="shrink-0 text-[11px] text-ink-4">
        {{ removable ? 'Du antwortest auf' : 'Antwort auf' }}
      </span>
      <RouterLink
        :to="{ name: 'member', params: { userId: quoted.createdBy } }"
        class="shrink-0 text-[11px] font-medium text-ink-2 hover:underline"
      >
        {{ quoted.createdByUsername }}
      </RouterLink>
      <span class="flex min-w-0 items-baseline text-[11px] text-ink-3">
        <span class="truncate">„{{ quoted.body }}</span>
        <!-- Das schließende Zeichen steht außerhalb des gekürzten Teils, sonst schnitte es der
             Browser mit ab: Ein Zitat soll auf …“ enden, nicht auf einem offenen Anfang. -->
        <span class="shrink-0">“</span>
      </span>

      <button
        v-if="removable"
        type="button"
        class="ml-auto shrink-0 rounded p-0.5 text-ink-4 hover:text-oak-deep"
        aria-label="Zitat verwerfen"
        @click="emit('remove')"
      >
        <X :size="13" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </div>

    <!-- Die Antwort selbst, in derselben Box. Beim Entwurf leer: Dort steht sie noch im Feld. -->
    <slot />
  </div>
</template>
